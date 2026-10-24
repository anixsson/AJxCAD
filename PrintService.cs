namespace AJxCAD;

// Hands PDF files to the operating system: print opens the PDF in the default PDF app and asks it to print.
public static class PrintService
{
    // Opens the PDF in the system's default PDF app with a request to print it (through its print dialog on Mac).
    // If the app ignores the print request, the PDF is still open there and can be printed from its menu.
    public static async Task PrintPdfAsync(string path)
    {
        if (!File.Exists(path)) throw new FileNotFoundException("The print file was not created.", path);
#if MACCATALYST
        await MainThread.InvokeOnMainThreadAsync(() => OpenInDefaultApp(path, print: true));
#elif WINDOWS
        try
        {
            // The "print" verb sends the file to the default PDF app's print command.
            System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(path) { UseShellExecute = true, Verb = "print" });
        }
        catch (System.ComponentModel.Win32Exception)
        {
            // No app registered a print command for PDF: open it so the user can print from the viewer.
            System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(path) { UseShellExecute = true });
        }
        await Task.CompletedTask;
#else
        await Launcher.Default.OpenAsync(new OpenFileRequest(Path.GetFileName(path), new ReadOnlyFile(path)));
#endif
    }

    // Opens the file in the system's default app for it.
    public static void OpenFile(string path)
    {
#if MACCATALYST
        // No existence check, as for RevealFile.
        OpenInDefaultApp(path, print: false);
#elif WINDOWS
        if (!File.Exists(path)) throw new FileNotFoundException("The exported file is no longer there.", path);
        System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(path) { UseShellExecute = true });
#endif
    }

    // Shows the file selected in Finder / Explorer.
    public static void RevealFile(string path)
    {
#if MACCATALYST
        // No existence check here: the sandbox may hide a file the user picked earlier, but Finder can still show it.
        var urls = Foundation.NSArray.FromObjects(Foundation.NSUrl.FromFilename(path));
        SendPtr(Workspace(), Sel("activateFileViewerSelectingURLs:"), urls.Handle);
#elif WINDOWS
        if (!File.Exists(path)) throw new FileNotFoundException("The exported file is no longer there.", path);
        System.Diagnostics.Process.Start("explorer.exe", $"/select,\"{path}\"");
#endif
    }

#if MACCATALYST
    const string ObjC = "/usr/lib/libobjc.dylib";

    [System.Runtime.InteropServices.DllImport(ObjC, EntryPoint = "objc_msgSend")]
    static extern IntPtr Send(IntPtr receiver, IntPtr selector);

    [System.Runtime.InteropServices.DllImport(ObjC, EntryPoint = "objc_msgSend")]
    static extern IntPtr SendPtr(IntPtr receiver, IntPtr selector, IntPtr arg);

    [System.Runtime.InteropServices.DllImport(ObjC, EntryPoint = "objc_msgSend")]
    static extern IntPtr SendEvent(IntPtr receiver, IntPtr selector, uint eventClass, uint eventId, IntPtr target, short returnId, int transactionId);

    [System.Runtime.InteropServices.DllImport(ObjC, EntryPoint = "objc_msgSend")]
    static extern void SendInsert(IntPtr receiver, IntPtr selector, IntPtr descriptor, nint index);

    [System.Runtime.InteropServices.DllImport(ObjC, EntryPoint = "objc_msgSend")]
    static extern void SendParam(IntPtr receiver, IntPtr selector, IntPtr descriptor, uint keyword);

    [System.Runtime.InteropServices.DllImport(ObjC, EntryPoint = "objc_msgSend")]
    static extern IntPtr SendByte(IntPtr receiver, IntPtr selector, byte value);

    [System.Runtime.InteropServices.DllImport(ObjC, EntryPoint = "objc_msgSend")]
    static extern void SendOpen(IntPtr receiver, IntPtr selector, IntPtr urls, IntPtr app, IntPtr configuration, IntPtr completion);

    static IntPtr Sel(string name) => ObjCRuntime.Selector.GetHandle(name);
    static IntPtr Cls(string name) => ObjCRuntime.Class.GetHandle(name);
    static IntPtr Workspace() => Send(Cls("NSWorkspace"), Sel("sharedWorkspace"));

    // Apple event codes for "print documents" ('aevt'/'pdoc'), its direct parameter ('----')
    // and its "print dialog" option ('pdlg'), which shows the print dialog instead of printing straight away.
    const uint CoreEventClass = 0x61657674, PrintDocuments = 0x70646f63, DirectObject = 0x2d2d2d2d, PrintDialog = 0x70646c67;

    // NSWorkspace works from the sandbox and lets the other app read the file.
    static void OpenInDefaultApp(string path, bool print)
    {
        var url = Foundation.NSUrl.FromFilename(path);
        var workspace = Workspace();
        var app = SendPtr(workspace, Sel("URLForApplicationToOpenURL:"), url.Handle);
        if (app == IntPtr.Zero) throw new InvalidOperationException("No app is set up to open PDF files.");

        var configuration = Send(Cls("NSWorkspaceOpenConfiguration"), Sel("configuration"));
        if (print)
        {
            var descriptor = Cls("NSAppleEventDescriptor");
            var ev = SendEvent(descriptor, Sel("appleEventWithEventClass:eventID:targetDescriptor:returnID:transactionID:"),
                CoreEventClass, PrintDocuments, IntPtr.Zero, -1, 0);
            var files = Send(descriptor, Sel("listDescriptor"));
            SendInsert(files, Sel("insertDescriptor:atIndex:"), SendPtr(descriptor, Sel("descriptorWithFileURL:"), url.Handle), 0);
            SendParam(ev, Sel("setParamDescriptor:forKeyword:"), files, DirectObject);
            SendParam(ev, Sel("setParamDescriptor:forKeyword:"), SendByte(descriptor, Sel("descriptorWithBoolean:"), 1), PrintDialog);
            SendPtr(configuration, Sel("setAppleEvent:"), ev);
        }
        var urls = Foundation.NSArray.FromObjects(url);
        SendOpen(workspace, Sel("openURLs:withApplicationAtURL:configuration:completionHandler:"), urls.Handle, app, configuration, IntPtr.Zero);
        GC.KeepAlive(url);
        GC.KeepAlive(urls);
    }
#endif
}
