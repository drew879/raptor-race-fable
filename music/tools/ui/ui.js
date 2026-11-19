// UI driver. osascript -l JavaScript ui.js '<json list of actions>' [quiet seconds] [max wait]
// Before acting it waits until Drew has left the keyboard and mouse alone for a while,
// and afterwards it puts the front app and the pointer back where they were.
ObjC.import('Cocoa');
const SE = Application('System Events');
// run from the repo's root: the hold file, the time stamp and the captures live beside this file
const DIR = $.NSFileManager.defaultManager.currentDirectoryPath.js + '/music/tools/ui';
const STAMP = DIR + '/last';
const now = () => Date.now() / 1000;
const idle = () => $.CGEventSourceSecondsSinceLastEventType(0, 4294967295);
function readStamp() {
  const s = $.NSString.stringWithContentsOfFileEncodingError(STAMP, $.NSUTF8StringEncoding, null);
  return s.isNil() ? 0 : parseFloat(s.js);
}
function writeStamp() { $(String(now())).writeToFileAtomicallyEncodingError(STAMP, true, $.NSUTF8StringEncoding, null); }
function post(type, x, y, button, clicks) {
  const ev = $.CGEventCreateMouseEvent(null, type, { x: x, y: y }, button);
  if (clicks) $.CGEventSetIntegerValueField(ev, $.kCGMouseEventClickState, clicks);
  $.CGEventPost($.kCGHIDEventTap, ev);
}
function run(argv) {
  const acts = JSON.parse(argv[0]);
  const QUIET = argv[1] ? parseFloat(argv[1]) : 10;
  const MAXWAIT = argv[2] ? parseFloat(argv[2]) : 240;
  const out = [];
  if ($.NSFileManager.defaultManager.fileExistsAtPath(DIR + '/HOLD')) throw new Error('HOLD: screen work is paused until Drew says to go on');
  // ---- never while a Zoom meeting is open (Drew: "can't risk having my computer taken over or sounds playing")
  if (!argv[3]) {
    try {
      const names = SE.processes.byName('zoom.us').windows.name();
      if (names.some((n) => n && n.indexOf('Zoom Meeting') === 0)) throw new Error('ZOOM: a meeting is open, nothing done');
    } catch (e) { /* Zoom is not running */ }
  }
  // ---- the gate
  const mine = readStamp();
  const t0 = now();
  let waited = 0;
  while (true) {
    const i = idle();
    const last = now() - i; // when the last event of any kind happened
    const foreign = last > mine + 0.6;
    if (!foreign || i >= QUIET) break;
    if (now() - t0 > MAXWAIT) throw new Error('BUSY: keyboard or mouse in use for ' + Math.round(now() - t0) + ' s, nothing done');
    delay(1);
    waited = now() - t0;
  }
  if (waited > 0) out.push('waited ' + waited.toFixed(0) + ' s for quiet');
  if (acts.length === 0) return out.concat(['idle ' + idle().toFixed(1) + ' s, mine ' + (now() - mine).toFixed(1) + ' s ago']).join('; ');
  // ---- remember where things were
  const front = SE.processes.whose({ frontmost: true })[0];
  const frontId = front.bundleIdentifier();
  const loc = $.CGEventGetLocation($.CGEventCreate(null));
  let keep = false;
  const L = $.kCGMouseButtonLeft, R = $.kCGMouseButtonRight;
  let failed = null;
  try {
  for (const a of acts) {
    const x = a.x, y = a.y;
    if (a.a === 'front') { Application(a.app).activate(); delay(a.s || 0.5); }
    else if (a.a === 'keep') keep = true;
    else if (a.a === 'clickwin' || a.a === 'shotwin') {
      // a click at a place inside one of the app's windows, found by the window's name, wherever the window is now;
      // or a picture of that window's part of the screen
      const ws = SE.processes.byName(a.proc || 'Live').windows;
      let found = null;
      for (let i = 0; i < ws.length; i++) { let nm = ''; try { nm = ws[i].name(); } catch (e) {} if (nm === a.win || (a.starts && nm && nm.indexOf(a.win) === 0)) { found = ws[i]; break; } }
      if (!found) throw new Error('no window named ' + a.win);
      const p = found.position(), z = found.size();
      if (a.a === 'shotwin') {
        const app = Application.currentApplication();
        app.includeStandardAdditions = true;
        app.doShellScript('screencapture -x -R ' + [p[0], p[1], z[0], z[1]].join(',') + ' ' + DIR + '/../shots/' + a.name + '.png');
        out.push('shotwin ' + a.win + ' @' + p.join(',') + ' ' + z.join('x'));
        continue;
      }
      const cx = p[0] + a.dx, cy = p[1] + a.dy;
      post($.kCGEventMouseMoved, cx, cy, L); delay(0.12);
      post($.kCGEventLeftMouseDown, cx, cy, L, 1); delay(0.05); post($.kCGEventLeftMouseUp, cx, cy, L, 1);
      delay(a.s || 0.4);
      out.push('clickwin ' + a.win + ' +' + a.dx + ',' + a.dy + ' = ' + cx + ',' + cy);
      continue;
    }
    else if (a.a === 'wins') {
      // the windows the app has open right now, and optionally move the ones not called `stay`
      const ws = SE.processes.byName(a.proc || 'Live').windows;
      const n = ws.length;
      for (let i = 0; i < n; i++) {
        const w = ws[i];
        let name = '';
        try { name = w.name(); } catch (e) { name = '?'; }
        if (a.to && name !== a.stay) { try { w.position = a.to; } catch (e) { out.push('could not move ' + name); } delay(0.3); }
        out.push('{' + name + ' @' + w.position().join(',') + ' ' + w.size().join('x') + '}');
      }
      continue;
    }
    else if (a.a === 'shot') {
      // a picture of the second display, taken while the app is still in front
      const app = Application.currentApplication();
      app.includeStandardAdditions = true;
      app.doShellScript('screencapture -x -R ' + (a.r || '1800,-222,1920,1080') + ' ' + DIR + '/../shots/' + a.name + '.png');
    }
    else if (a.a === 'menu' || a.a === 'mark') {
      // a menu item of Live, by name: ['Options', 'Audio Engine On']. 'mark' only reads its tick.
      const menu = SE.processes.byName(a.proc || 'Live').menuBars[0].menuBarItems.byName(a.path[0]).menus[0];
      let item = menu.menuItems.byName(a.path[1]);
      if (!item.exists()) {
        // (by the start of its name: some end in an ellipsis)
        const names = menu.menuItems.name();
        const k = names.findIndex((n) => n && n.indexOf(a.path[1]) === 0);
        if (k < 0) { out.push('[no menu item ' + a.path[1] + ' in ' + JSON.stringify(names) + ']'); continue; }
        item = menu.menuItems[k];
      }
      if (a.path[2]) item = item.menus[0].menuItems.byName(a.path[2]);
      if (a.a === 'menu') { item.click(); delay(a.s || 0.6); }
      let tick = '';
      try { tick = item.attributes.byName('AXMenuItemMarkChar').value(); } catch (e) { tick = '?'; }
      out.push('[' + a.path.join('>') + ' tick=' + JSON.stringify(tick) + ' enabled=' + item.enabled() + ']');
      continue;
    }
    else if (a.a === 'wait') delay(a.s);
    else if (a.a === 'type') { SE.keystroke(a.text); delay(0.15); }
    else if (a.a === 'key') { SE.keyCode(a.code, { using: (a.mods || []).map((m) => m + ' down') }); delay(a.s || 0.15); }
    else if (a.a === 'char') { SE.keystroke(a.ch, { using: (a.mods || []).map((m) => m + ' down') }); delay(a.s || 0.15); }
    else {
      post($.kCGEventMouseMoved, x, y, L); delay(0.1);
      if (a.a === 'click') { post($.kCGEventLeftMouseDown, x, y, L, 1); delay(0.05); post($.kCGEventLeftMouseUp, x, y, L, 1); }
      else if (a.a === 'dclick') {
        post($.kCGEventLeftMouseDown, x, y, L, 1); delay(0.03); post($.kCGEventLeftMouseUp, x, y, L, 1); delay(0.07);
        post($.kCGEventLeftMouseDown, x, y, L, 2); delay(0.03); post($.kCGEventLeftMouseUp, x, y, L, 2);
      } else if (a.a === 'rclick') { post($.kCGEventRightMouseDown, x, y, R, 1); delay(0.05); post($.kCGEventRightMouseUp, x, y, R, 1); }
      else if (a.a === 'drag') {
        post($.kCGEventLeftMouseDown, x, y, L, 1); delay(0.2);
        const n = a.n || 24;
        for (let i = 1; i <= n; i++) { post($.kCGEventLeftMouseDragged, x + (a.x2 - x) * i / n, y + (a.y2 - y) * i / n, L, 1); delay(0.02); }
        delay(0.25); post($.kCGEventLeftMouseUp, a.x2, a.y2, L, 1);
      } else if (a.a === 'scroll') {
        const ev = $.CGEventCreateScrollWheelEvent2(null, 0, 1, a.dy, 0, 0);
        $.CGEventPost($.kCGHIDEventTap, ev);
      }
      delay(a.s || 0.25);
    }
    out.push(a.a);
  }
  } catch (e) { failed = e; }
  if (!keep || failed) {
    try { Application(frontId).activate(); } catch (e) { out.push('could not restore ' + frontId); }
    post($.kCGEventMouseMoved, loc.x, loc.y, L);
  }
  delay(0.1);
  writeStamp();
  if (failed) throw new Error('FAILED after [' + out.join(' ') + ']: ' + failed + ' (front app put back: ' + frontId + ')');
  return out.join(' ') + ' | front was ' + frontId;
}
