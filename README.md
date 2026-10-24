# AJxCAD

AJxCAD is a focused 2D CAD workspace for macOS and Windows, built with .NET MAUI and Blazor Hybrid.

## Features

- Draw and edit connected lines on an adaptive grid, with endpoint snapping and undo.
- Save and open `.ajx` project files, including drawing data, project settings, and the saved view.
- Inspect project and drawing data in the read-only Data Buckets viewer.

## Requirements

- .NET 10 SDK with the .NET MAUI workload.
- Xcode for building and running on macOS, or Visual Studio with the .NET MAUI workload for Windows.
- Node.js to run the JavaScript tests.

## Build and run

Build for the current platform:

```sh
dotnet build AJxCAD.csproj
```

Run on macOS:

```sh
dotnet build AJxCAD.csproj -f net10.0-maccatalyst -t:Run
```

Run on Windows:

```sh
dotnet build AJxCAD.csproj -f net10.0-windows10.0.19041.0 -t:Run
```

## Tests

```sh
node --test tests/*.test.mjs
```

## Distribution

The app currently uses the default `com.companyname.ajxcad` application identifier. Replace it with an identifier owned by the publisher before creating signed or store-distributed builds.
