-- recam: crittercam's free cam for RESIDENT EVIL 4 and 2 (REFramework). Installed and configured by the re cam app.
-- Settings + key bindings come in through reframework/data/recam_cmd.json, state + messages go out through recam_state.json.
-- Speeds use crittercam's units: per 8 ms tick, radians for look speed and zoom.

local VERSION = "6" -- bump on every change: the app compares it to tell an old script still running from the new one
local TICK = 0.008
local MOUSE_SPEED_CORRECTION = 0.2
local FOV_CHANGE_SCALE = 0.01
local PITCH_LIMIT = math.rad(89)
local DEADZONE = 0.15

local S = { movementSpeed = 0.05, rotationSpeed = 0.01, fastMultiplier = 5, slowMultiplier = 0.1, upMultiplier = 0.7,
    fovSpeed = 0.3, controlDevice = 0, invertY = false } -- controlDevice: 0 keyboard & mouse, 1 controller, 2 both
local K = {}
for id, vk in pairs({ toggle = 45, lock = 145, block = 8, forward = 87, back = 83, left = 65, right = 68, up = 82, down = 70,
    lookUp = 38, lookDown = 40, lookLeft = 37, lookRight = 39, tiltLeft = 90, tiltRight = 88, zoomIn = 33, zoomOut = 34, zoomReset = 36 }) do
    K[id] = { vk = vk }
end

-- yaw: + turns left, pitch: + looks up, roll: + tilts left. fov in degrees (via.Camera), fov0 = the game's when we took over.
local cam = { on = false, blocked = true, locked = false, pos = nil, yaw = 0, pitch = 0, roll = 0, fov = 70, fov0 = 70 }
local note = { n = 0, text = "" }
local warn = nil -- shown in the app's status card
local function notify(text) note = { n = note.n + 1, text = text } end

------------------------------------------------------------------------------------------------ engine access

local td = sdk.find_type_definition
local T = {
    app = td("via.Application"), kb = td("via.hid.Keyboard"), kbdev = td("via.hid.KeyboardDevice"),
    mouse = td("via.hid.Mouse"), mousedev = td("via.hid.MouseDevice"), pad = td("via.hid.GamePad"), paddev = td("via.hid.GamePadDevice"),
}

local function nat(t, name, method, ...)
    local s = sdk.get_native_singleton(name)
    return s and sdk.call_native_func(s, t, method, ...)
end

-- native devices may come back as raw pointers rather than managed objects
local function dcall(obj, t, method, ...)
    if sdk.is_managed_object(obj) then return obj:call(method, ...) end
    return sdk.call_native_func(obj, t, method, ...)
end

local function xy(p)
    local ok, x = pcall(function() return p.x end)
    if ok and x then return x, p.y end
    return p:get_field("x"), p:get_field("y")
end

local function enum(type_name, names)
    local t, out, missing = td(type_name), {}, {}
    for key, name in pairs(names) do
        local f = t and t:get_field(name)
        out[key] = f and f:get_data(nil) or 0
        if not f then missing[#missing + 1] = name end
    end
    if #missing > 0 then
        local all = {}
        for _, f in ipairs(t and t:get_fields() or {}) do if f:is_static() then all[#all + 1] = f:get_name() end end
        warn = type_name .. " has no " .. table.concat(missing, ", ") .. ". it has: " .. table.concat(all, " ")
    end
    return out
end

local PAD = enum("via.hid.GamePadButton", { y = "RUp", x = "RLeft", b = "RRight", up = "LUp", down = "LDown", left = "LLeft", right = "LRight" })
local MB = enum("via.hid.MouseButton", { l = "L", r = "R" })
-- the app sends windows virtual key codes; RE Engine's KeyboardKey should be the same numbers
if enum("via.hid.KeyboardKey", { ins = "Insert" }).ins ~= 45 then warn = warn or "via.hid.KeyboardKey isn't windows key codes, keys will be wrong" end

------------------------------------------------------------------------------------------------ math

local function qmul(a, b)
    return { a[1] * b[1] - a[2] * b[2] - a[3] * b[3] - a[4] * b[4], a[1] * b[2] + a[2] * b[1] + a[3] * b[4] - a[4] * b[3],
        a[1] * b[3] - a[2] * b[4] + a[3] * b[1] + a[4] * b[2], a[1] * b[4] + a[2] * b[3] - a[3] * b[2] + a[4] * b[1] }
end

-- {w,x,y,z}: yaw about Y, then pitch about X, then roll about the view axis (the camera looks down -Z)
local function rotation()
    local q = qmul(qmul({ math.cos(cam.yaw / 2), 0, math.sin(cam.yaw / 2), 0 }, { math.cos(cam.pitch / 2), math.sin(cam.pitch / 2), 0, 0 }),
        { math.cos(cam.roll / 2), 0, 0, math.sin(cam.roll / 2) })
    return q
end

local function rotate(q, x, y, z)
    local r = qmul(qmul(q, { 0, x, y, z }), { q[1], -q[2], -q[3], -q[4] })
    return r[2], r[3], r[4]
end

local function wrap(a) return (a + math.pi) % (2 * math.pi) - math.pi end

------------------------------------------------------------------------------------------------ camera

local function camera()
    local c = sdk.get_primary_camera()
    return c, c and c:call("get_GameObject"):call("get_Transform")
end

local GAME = td("chainsaw.CameraSystem") and "re4" or td("app.ropeway.camera.CameraSystem") and "re2" or nil
if not GAME then warn = "unknown game: the camera works, but blocking game input doesn't" end

local function main_camera_controller()
    if GAME == "re4" then
        local cs = sdk.get_managed_singleton("chainsaw.CameraSystem")
        return cs and cs:call("get_MainCameraController")
    elseif GAME == "re2" then
        local cs = sdk.get_managed_singleton("app.ropeway.camera.CameraSystem")
        return cs and cs:get_field("MainCameraController")
    end
end

local function toggle_camera()
    if not cam.on then
        local c, t = camera()
        if not t then return end
        local p, q = t:call("get_Position"), t:call("get_Rotation")
        local fx, fy, fz = -2 * (q.x * q.z + q.w * q.y), -2 * (q.y * q.z - q.w * q.x), -(1 - 2 * (q.x * q.x + q.y * q.y))
        cam.pos = { p.x, p.y, p.z }
        cam.yaw, cam.pitch, cam.roll = math.atan(-fx, -fz), math.asin(math.max(-1, math.min(1, fy))), 0
        cam.fov0 = c:call("get_FOV")
        cam.fov = cam.fov0
        cam.on = true
        notify("Camera enabled")
    else
        cam.on = false
        local c = camera()
        if c then c:call("set_FOV", cam.fov0) end
        notify("Camera disabled")
    end
end

local move = { 0, 0, 0 } -- this frame's movement in camera space: right, up, back

local function move_right(a) move[1] = move[1] + S.movementSpeed * a end
local function move_up(a) move[2] = move[2] + S.movementSpeed * a * S.upMultiplier end
local function move_forward(a) move[3] = move[3] - S.movementSpeed * a end
local function yaw(a) cam.yaw = wrap(cam.yaw - S.rotationSpeed * a) end -- + amount turns right
local function pitch(a) cam.pitch = math.max(-PITCH_LIMIT, math.min(PITCH_LIMIT, cam.pitch + S.rotationSpeed * a * (S.invertY and -1 or 1))) end
local function roll(a) cam.roll = wrap(cam.roll + S.rotationSpeed * a) end
local function change_fov(radians) cam.fov = math.max(0.5, math.min(170, cam.fov + math.deg(radians))) end

local function kbm_controls_camera() return S.controlDevice ~= 1 end
local function pad_controls_camera() return S.controlDevice ~= 0 end

------------------------------------------------------------------------------------------------ input

-- The camera key can be REFramework's menu key too (both default to Insert). A toggle press waits a few frames: if the
-- menu opened or closed around it, the press was for the menu and the camera stays as it is.
local tick, ui_was, ui_changed_at, toggle_at = 0, false, -100, nil
local TOGGLE_WAIT = 6

-- The game's devices keep reporting while it's in the background. The app writes whether re4 is the active window;
-- no file or a stale one (app closed) = assume it is.
local focused = true

local function handle_input()
    if tick % 3 == 0 then
        local f = json.load_file("recam_focus.json")
        focused = not f or os.time() - (f.at or 0) > 3 or f.focused == true
    end
    if not focused then
        tick = tick + 1
        toggle_at = nil
        return
    end
    local kb = nat(T.kb, "via.hid.Keyboard", "get_Device")
    if not kb then return end
    local function down(vk) return dcall(kb, T.kbdev, "isDown", vk) end
    local alt = down(18) or down(164) or down(165)
    local ctrl = down(17) or down(162) or down(163)
    local shift = down(16) or down(160) or down(161)
    local function held(id) return down(K[id].vk) end -- held keys ignore modifiers, so alt / ctrl can speed them up
    local function pressed(id)
        local b = K[id]
        return dcall(kb, T.kbdev, "isTrigger", b.vk) and alt == not not b.alt and ctrl == not not b.ctrl and shift == not not b.shift
    end

    tick = tick + 1
    local ui = reframework:is_drawing_ui()
    if ui ~= ui_was then ui_was, ui_changed_at = ui, tick end
    if pressed("toggle") then toggle_at = tick end
    if toggle_at and tick - toggle_at >= TOGGLE_WAIT then
        if ui_changed_at < toggle_at - 1 then toggle_camera() end
        toggle_at = nil
    end
    if ui then return end -- typing in the reframework menu shouldn't fly the camera
    if not cam.on then return end
    if pressed("block") then
        cam.blocked = not cam.blocked
        notify(cam.blocked and "Input to game blocked" or "Input to game enabled")
    end

    local dt = (nat(T.app, "via.Application", "get_FrameTimeMillisecond") or 16) / 1000
    local frame_scale = math.min(dt / TICK, 10)
    local mouse = nat(T.mouse, "via.hid.Mouse", "get_Device")
    local mouse_ok = mouse ~= nil

    if kbm_controls_camera() then
        if pressed("zoomReset") then cam.fov = cam.fov0 end
        if held("zoomIn") then change_fov(-S.fovSpeed * FOV_CHANGE_SCALE * frame_scale) end
        if held("zoomOut") then change_fov(S.fovSpeed * FOV_CHANGE_SCALE * frame_scale) end
        if mouse_ok then
            local wheel = dcall(mouse, T.mousedev, "get_WheelDelta") or 0
            if wheel ~= 0 then change_fov(-(wheel / (math.abs(wheel) >= 120 and 120 or 1)) * S.fovSpeed * FOV_CHANGE_SCALE) end
        end
    end

    if pressed("lock") then
        cam.locked = not cam.locked
        notify(cam.locked and "Camera movement is locked" or "Camera movement is unlocked")
    end
    if cam.locked then return end

    local multiplier = alt and S.fastMultiplier or ctrl and S.slowMultiplier or 1
    -- zoomed in = move slower, so it stays controllable
    multiplier = multiplier * math.max(0.01, math.min(1, cam.fov / cam.fov0))

    if kbm_controls_camera() then
        local m = multiplier * frame_scale
        if held("forward") then move_forward(m) end
        if held("back") then move_forward(-m) end
        if held("right") then move_right(m) end
        if held("left") then move_right(-m) end
        if held("up") then move_up(m) end
        if held("down") then move_up(-m) end
        if held("lookUp") then pitch(m) end
        if held("lookDown") then pitch(-m) end
        if held("lookRight") then yaw(m) end
        if held("lookLeft") then yaw(-m) end
        if held("tiltLeft") then roll(m) end
        if held("tiltRight") then roll(-m) end

        if mouse_ok then
            local dx, dy = xy(dcall(mouse, T.mousedev, "get_DeltaPosition"))
            local buttons = math.tointeger(dcall(mouse, T.mousedev, "get_Button")) or 0
            local l, r = buttons & MB.l ~= 0, buttons & MB.r ~= 0
            local x, y = dx * MOUSE_SPEED_CORRECTION * multiplier, dy * MOUSE_SPEED_CORRECTION * multiplier
            -- crittercam's mouse: no button looks, left button flies up / down, right flies forward / back, both tilt
            if y ~= 0 then
                if not (l or r) then pitch(-y) elseif l then move_up(-y) else move_forward(-y) end
            end
            if x ~= 0 then
                if not (l or r) then yaw(x) elseif l and r then roll(-x) else move_right(x) end
            end
        end
    end

    if pad_controls_camera() then
        local ok, pad = pcall(nat, T.pad, "via.hid.GamePad", "get_MergedDevice")
        if ok and pad then
            local buttons = math.tointeger(dcall(pad, T.paddev, "get_Button")) or 0
            local function btn(b) return b ~= 0 and buttons & b ~= 0 end
            local function dz(v) return math.abs(v) < DEADZONE and 0 or v end
            local m = (btn(PAD.y) and S.fastMultiplier or btn(PAD.x) and S.slowMultiplier or multiplier) * frame_scale
            local rx, ry = xy(dcall(pad, T.paddev, "get_AxisR"))
            local lx, ly = xy(dcall(pad, T.paddev, "get_AxisL"))
            pitch(dz(ry) * m)
            yaw(dz(rx) * m)
            move_up(((dcall(pad, T.paddev, "get_AnalogL") or 0) - (dcall(pad, T.paddev, "get_AnalogR") or 0)) * m)
            move_forward(dz(ly) * m)
            move_right(dz(lx) * m)
            if btn(PAD.left) then roll(m) end
            if btn(PAD.right) then roll(-m) end
            if btn(PAD.b) then cam.fov = cam.fov0 end
            if btn(PAD.up) then change_fov(-S.fovSpeed * FOV_CHANGE_SCALE * frame_scale) end
            if btn(PAD.down) then change_fov(S.fovSpeed * FOV_CHANGE_SCALE * frame_scale) end
        end
    end
end

local function apply_movement()
    if move[1] ~= 0 or move[2] ~= 0 or move[3] ~= 0 then
        local wx, wy, wz = rotate(rotation(), move[1], move[2], move[3])
        cam.pos = { cam.pos[1] + wx, cam.pos[2] + wy, cam.pos[3] + wz }
    end
    move = { 0, 0, 0 }
end

local function write_camera()
    if not cam.on or not cam.pos then return end
    local c, t = camera()
    if not t then return end
    local q = rotation()
    local rot = Quaternion.new(q[1], q[2], q[3], q[4])
    t:call("set_Position", Vector3f.new(cam.pos[1], cam.pos[2], cam.pos[3]))
    t:call("set_Rotation", rot)
    c:call("set_FOV", cam.fov)
    -- the player's movement reads the game camera's rotation: hand it ours, so a pad moves the player relative to the free cam.
    -- the fov too: the game copies it into the camera, so it can't overwrite ours with its own
    local mcc = main_camera_controller()
    if mcc and GAME == "re4" then
        mcc:set_field("_CameraRotation", rot)
        mcc:set_field("_FOV", cam.fov)
    elseif mcc and GAME == "re2" then
        mcc:call("set_CameraRotation", rot)
        mcc:call("set_FOV", cam.fov)
    end
end

------------------------------------------------------------------------------------------------ blocking game input

-- The game reads input through share.hid.Device components (one per keyboard / mouse / pad). For the devices that drive
-- the camera we skip their update and point them at the engine's null device, so the game sees nothing from them,
-- while we keep reading the real devices through the via.hid singletons.
local function blocks(dev)
    if not (cam.on and cam.blocked) then return nil end
    if kbm_controls_camera() then
        if dev:call("get_IsKeyboardDevice") then return nat(T.kb, "via.hid.Keyboard", "get_NullDevice") end
        if dev:call("get_IsMouseDevice") then return nat(T.mouse, "via.hid.Mouse", "get_NullDevice") end
    end
    if pad_controls_camera() and dev:call("get_IsGamePadDevice") then return nat(T.pad, "via.hid.GamePad", "get_NullDevice") end
end

local swapped = {} -- key -> { obj, field, real }: an input object pointed at the engine's null device while blocked

-- point obj.field at null (blocking), or back at the real device (null = nil). Re-checked every frame, so a device the
-- game assigns while we block gets swapped too.
local function swap(key, obj, field, null)
    if null then
        local cur = obj:get_field(field)
        local addr = function(o) return sdk.is_managed_object(o) and o:get_address() or o end
        if cur ~= nil and addr(cur) ~= addr(null) then
            swapped[key] = { obj = obj, field = field, real = cur }
            obj:set_field(field, null)
        end
    elseif swapped[key] then
        obj:set_field(field, swapped[key].real)
        swapped[key] = nil
    end
end

local dev_t = td("share.hid.Device")
for _, m in ipairs(dev_t and dev_t:get_methods() or {}) do
    if m:get_name() == "update" and m:get_num_params() == 0 then
        sdk.hook(m, function(args)
            local dev = sdk.to_managed_object(args[2])
            if not dev then return end
            local addr = dev:get_address()
            local null = blocks(dev)
            if null then
                swap(addr, dev, "_NativeDevice", null)
                dev:call("resetParam")
                return sdk.PreHookResult.SKIP_ORIGINAL
            end
            swap(addr, dev, "_NativeDevice", nil)
        end, function(rv) return rv end)
    end
end

-- RE2: one app.ropeway.InputUnit per player holds the pad, keyboard and mouse it reads. Same null device trick, and
-- the game's own "ignore the mouse" request for its mouse look.
local mouse_ignored = false
local unit_t = td("app.ropeway.InputUnit")
for _, m in ipairs(unit_t and unit_t:get_methods() or {}) do
    if m:get_name() == "update" and m:get_num_params() == 0 then
        sdk.hook(m, function(args)
            local unit = sdk.to_managed_object(args[2])
            if not unit then return end
            local blocking = cam.on and cam.blocked
            local kbm, pad = blocking and kbm_controls_camera(), blocking and pad_controls_camera()
            local a = unit:get_address()
            swap(a .. "k", unit, "<Keyboard>k__BackingField", kbm and nat(T.kb, "via.hid.Keyboard", "get_NullDevice") or nil)
            swap(a .. "m", unit, "<Mouse>k__BackingField", kbm and nat(T.mouse, "via.hid.Mouse", "get_NullDevice") or nil)
            swap(a .. "p", unit, "<Device>k__BackingField", pad and nat(T.pad, "via.hid.GamePad", "get_NullDevice") or nil)
            if kbm ~= mouse_ignored then
                local input = sdk.get_managed_singleton("app.ropeway.InputSystem")
                if input then
                    input:call(kbm and "requestIgnoreMouseMove" or "removeIgnoreMouseMove", "recam")
                    mouse_ignored = kbm
                end
            end
        end, function(rv) return rv end)
    end
end

-- reset scripts / unload while blocked: give the game its devices back
re.on_script_reset(function()
    for _, s in pairs(swapped) do pcall(function() s.obj:set_field(s.field, s.real) end) end
    if mouse_ignored then pcall(function() sdk.get_managed_singleton("app.ropeway.InputSystem"):call("removeIgnoreMouseMove", "recam") end) end
    local c = camera()
    if cam.on and c then c:call("set_FOV", cam.fov0) end
end)

-- When every device drives the camera, also empty the game's commands: catches anything that skips share.hid.Device.
local cmd_t = td("share.hid.Command")
for _, m in ipairs(cmd_t and cmd_t:get_methods() or {}) do
    local n = m:get_name()
    if n == "update" or n == "updateKeyAssign" or n == "updateExtraCommand" then
        sdk.hook(m, function(args)
            if cam.on and cam.blocked and S.controlDevice == 2 then
                sdk.to_managed_object(args[2]):call("reset")
                return sdk.PreHookResult.SKIP_ORIGINAL
            end
        end, function(rv) return rv end)
    end
end

------------------------------------------------------------------------------------------------ the app

local frame, last_seq = 0, nil
local boot = os.time()

local function sync_app()
    frame = frame + 1
    if frame % 10 == 0 then
        local c = json.load_file("recam_cmd.json")
        if c and c.seq ~= last_seq then
            last_seq = c.seq
            for k, v in pairs(c.settings or {}) do if S[k] ~= nil then S[k] = v end end
            for k, v in pairs(c.bindings or {}) do if K[k] and v.vk then K[k] = v end end
        end
    end
    if frame % 15 == 0 then
        local n = 0
        for _ in pairs(swapped) do n = n + 1 end
        json.dump_file("recam_state.json", { v = VERSION, swapped = n, boot = boot, t = frame, on = cam.on, blocked = cam.blocked, locked = cam.locked,
            fov = cam.on and cam.fov or nil, note = note.n > 0 and note or nil, warn = warn })
    end
end

re.on_pre_application_entry("BeginRendering", function()
    handle_input()
    if cam.on then apply_movement() end
    write_camera()
    sync_app()
end)
-- second write in case something reads the camera between the game's late update and rendering
re.on_application_entry("LateUpdateBehavior", write_camera)
