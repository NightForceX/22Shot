# 22Shot — Manual Test Checklist

## Capture

- [ ] Selected region works (drag, resize handles, move, Esc, Enter)
- [ ] Element selection works (hover highlight, Alt+Up/Down, click)
- [ ] Visible screenshot works
- [ ] Full-page screenshot works
- [ ] Capture at page top
- [ ] Capture while already halfway down page
- [ ] Original scroll position restored
- [ ] Fixed header not duplicated (Auto)
- [ ] Sticky header not duplicated (Auto)
- [ ] Lazy-loaded images captured (Options → include lazy content)
- [ ] Internal scroll element captured
- [ ] Iframe visible capture works
- [ ] Full iframe capture works where permissions permit
- [ ] High-DPI image remains sharp

## Export / clipboard

- [ ] PNG export works
- [ ] JPG export works
- [ ] WEBP export works
- [ ] Screenshot-document PDF export works
- [ ] Multi-page PDF works
- [ ] Clipboard copy works
- [ ] Filename editing works
- [ ] Save Webpage as PDF works (non-macOS)

## Editor

- [ ] Blur appears in exported image
- [ ] Pixelate appears in exported image
- [ ] Redaction appears in exported image
- [ ] Undo works
- [ ] Redo works
- [ ] Annotations (rect/arrow/line/text/highlight/draw) export correctly

## Resilience

- [ ] Browser state restored after error/cancel
- [ ] Document survives Firefox restart
- [ ] Multiple screenshots can be added to same PDF document
- [ ] Oversized page shows a clear error instead of crashing
