ObjC.import('CoreGraphics');
ObjC.import('Foundation');
function run(argv) {
  const want = argv[0] || '';
  const list = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly | $.kCGWindowListExcludeDesktopElements, 0)));
  const out = [];
  for (const w of list) {
    const owner = w.kCGWindowOwnerName || '';
    if (want && owner.indexOf(want) < 0) continue;
    if (w.kCGWindowLayer !== 0) continue;
    const b = w.kCGWindowBounds;
    out.push([w.kCGWindowNumber, owner, w.kCGWindowName || '', b.X, b.Y, b.Width, b.Height].join(' | '));
  }
  return out.join('\n');
}
