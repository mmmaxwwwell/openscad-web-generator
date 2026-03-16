# Slice Cube E2E Test — UI Flow

## Mermaid: Full UI Flow (File Selection → Slice → GCode)

```mermaid
flowchart TD
    Start([App Loads]) --> Disclaimer{Disclaimer<br/>shown?}
    Disclaimer -->|Yes| AcceptDisclaimer["Click '.disclaimer-ok-btn'<br/>OK, I understand"]
    Disclaimer -->|No| FileScreen
    AcceptDisclaimer --> FileScreen

    FileScreen["File Selection Screen<br/>'.app-container--files'"]
    FileScreen --> LoadExample["Click '.example-load-btn'<br/>for '1cm Cube'"]

    LoadExample --> EditorScreen["Editor Screen<br/>'.app-container'"]
    EditorScreen --> WaitWASM["Wait for '.wasm-status--ready'<br/>WASM: Ready"]

    WaitWASM --> RenderSTL["Click '.export-render-btn'<br/>in STL section"]
    RenderSTL --> WaitRender["Wait for button text<br/>'Re-render' (cached)"]

    WaitRender --> NeedPrinter{Printer<br/>configured?}
    NeedPrinter -->|No| AddPrinter["Inject printer into<br/>localStorage 'printers'"]
    NeedPrinter -->|Yes| SendToPrinter
    AddPrinter --> ReloadPage["Reload page to<br/>pick up printer"]
    ReloadPage --> FileScreen

    SendToPrinter["Click '.send-to-printer-btn'<br/>Send to Printer"]
    SendToPrinter --> PrintDialog["Print Dialog opens<br/>'.print-dialog'"]

    PrintDialog --> ClickSlice["Click '.print-dialog-slice-btn'<br/>Slice"]
    ClickSlice --> Slicing["Phase: slicing<br/>'.print-dialog-progress-bar'"]

    Slicing --> SliceOutcome{Slice<br/>result?}
    SliceOutcome -->|Success| Done["Phase: done<br/>'.print-dialog-done'<br/>GCode available"]
    SliceOutcome -->|Error| Error["Phase: error<br/>'.print-dialog-error'"]

    Done --> ExtractGCode["Extract GCode via<br/>page.evaluate()"]
    ExtractGCode --> ValidateGCode["Validate GCode:<br/>- Has G0/G1 moves<br/>- Has layer changes<br/>- Z within 10mm cube<br/>- Extrusion (E values)"]
    ValidateGCode --> SaveGCode["Save GCode to<br/>test-output/cube_1cm.gcode"]
    SaveGCode --> End([Test Complete])

    Error --> CaptureError["Capture error message<br/>+ slicer debug log"]
    CaptureError --> FailWithDiag["Fail with structured<br/>diagnostic output"]
    FailWithDiag --> End
```

## Test Strategy

The test:
1. Injects a fake printer into localStorage (avoids needing a real Moonraker instance)
2. Navigates to the app via URL with `?example=cube_1cm.scad` to skip file selection
3. Waits for WASM to load, renders STL, opens print dialog, slices
4. Extracts the GCode string from the browser context
5. Validates GCode structure (moves, layers, dimensions, extrusion)
6. Saves GCode to disk for offline inspection
7. On failure, captures full diagnostic context (console logs, slicer debug log, screenshots)

## CSS Selectors Reference

| Step | Selector | What |
|------|----------|------|
| Disclaimer | `.disclaimer-ok-btn` | Accept button |
| Load example | `.example-load-btn` | Per-example load button |
| WASM ready | `.wasm-status--ready` | Status indicator |
| Render STL | `.export-render-btn` | First render button (STL section) |
| Send to printer | `.send-to-printer-btn` | Opens printer dropdown |
| Printer option | `.send-to-printer-option` | Specific printer in dropdown |
| Slice | `.print-dialog-slice-btn` | Start slicing |
| Progress | `.print-dialog-progress-bar` | Slicing progress |
| Done | Text: "Slicing complete" | Success indicator |
| Error | `.print-dialog-error` | Error container |
| Download | `.print-dialog-download-btn` | Download GCode button |
