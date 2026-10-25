# AJxCAD

AJxCAD is a 2D CAD workspace for macOS and Windows, built with .NET MAUI and Blazor Hybrid.

Create and edit drawings with tools for lines, circles, rectangles, text, points, and measurements. Grid snapping helps place geometry accurately, while selection, editing, and undo make it easy to refine a design.

Organize projects with pages and layers, and reuse geometry by placing another AJxCAD project as a symbol. Set up page layouts, preview your drawings, then print or export them as PDF. Projects can be saved as `.ajx` files.

## Development

- .NET SDK 10.0.402 (or a later patch in the same feature band), selected by `global.json`.
- .NET MAUI packages 10.0.120 with workload set 10.0.402.1.
- On macOS: Xcode 27.1. The app requires macOS 14 or newer (Mac Catalyst 17.0).
- On Windows: the .NET MAUI Windows workload and Windows SDK for the existing `net10.0-windows10.0.19041.0` target.

Install workloads from the repository directory:

```sh
# macOS (requires administrator privileges for a system-wide SDK)
sudo dotnet workload install maui --version 10.0.402.1

# Windows (elevated terminal for a system-wide SDK)
dotnet workload install maui-windows --version 10.0.402.1
```

Build and run:

```sh
dotnet build AJxCAD.csproj
dotnet run --project AJxCAD.csproj --configuration Debug
```

The Mac Catalyst head uses MAUI's scene lifecycle, as required by Xcode 27.

## Screenshots

![Screenshot overall intro](Resources/Images/printscreen/Screenshot%20overall%20intro.png)

| Print pages | Components |
| --- | --- |
| ![Screenshot toprintpages](Resources/Images/printscreen/Screenshot%20toprintpages.png) | ![Screenshot with components](Resources/Images/printscreen/Screenshot%20with%20components.png) |