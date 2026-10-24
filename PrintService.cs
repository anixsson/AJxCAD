namespace AJxCAD;

// Hands a PDF file to the operating system's own print session.
public static class PrintService
{
    // Shows the file selected in Finder / Explorer.
    public static void RevealFile(string path)
    {
#if MACCATALYST
        // No existence check here: the sandbox may hide a file the user picked earlier, but Finder can still show it.
        var urls = Foundation.NSArray.FromObjects(Foundation.NSUrl.FromFilename(path));
        var workspace = Send(ObjCRuntime.Class.GetHandle("NSWorkspace"), ObjCRuntime.Selector.GetHandle("sharedWorkspace"));
        SendPtr(workspace, ObjCRuntime.Selector.GetHandle("activateFileViewerSelectingURLs:"), urls.Handle);
#elif WINDOWS
        if (!File.Exists(path)) throw new FileNotFoundException("The exported file is no longer there.", path);
        System.Diagnostics.Process.Start("explorer.exe", $"/select,\"{path}\"");
#endif
    }

#if MACCATALYST
    [System.Runtime.InteropServices.DllImport("/usr/lib/libobjc.dylib", EntryPoint = "objc_msgSend")]
    static extern IntPtr Send(IntPtr receiver, IntPtr selector);

    [System.Runtime.InteropServices.DllImport("/usr/lib/libobjc.dylib", EntryPoint = "objc_msgSend")]
    static extern void SendPtr(IntPtr receiver, IntPtr selector, IntPtr arg);
#endif

#if MACCATALYST
    // The web view must stay alive (and in the window) until printing is done.
    static WebKit.WKWebView? _web;

    // Loads the PDF into an invisible web view, then prints what the web view shows.
    static Task PrintInHiddenWebView(string path)
    {
        var done = new TaskCompletionSource();
        var window = UIKit.UIApplication.SharedApplication.ConnectedScenes.ToArray()
            .OfType<UIKit.UIWindowScene>().SelectMany(s => s.Windows).FirstOrDefault(w => w.IsKeyWindow)
            ?? throw new InvalidOperationException("No window to print from.");

        _web?.RemoveFromSuperview();
        var web = new WebKit.WKWebView(new CoreGraphics.CGRect(0, 0, 600, 800), new WebKit.WKWebViewConfiguration())
        {
            Alpha = 0,
            UserInteractionEnabled = false
        };
        _web = web;
        window.AddSubview(web);

        web.NavigationDelegate = new LoadedDelegate(ok =>
        {
            if (!ok)
            {
                Cleanup();
                done.TrySetException(new InvalidOperationException("The PDF could not be loaded for printing."));
                return;
            }
            // Exceptions must not escape a native callback: that aborts the app.
            try
            {
                var info = UIKit.UIPrintInfo.PrintInfo;
                info.JobName = Path.GetFileNameWithoutExtension(path);
                info.OutputType = UIKit.UIPrintInfoOutputType.General;
                var controller = UIKit.UIPrintInteractionController.SharedPrintController;
                controller.PrintInfo = info;
                controller.PrintFormatter = web.ViewPrintFormatter;
                controller.Present(true, (_, _, error) =>
                {
                    Cleanup();
                    if (error is not null) done.TrySetException(new InvalidOperationException(error.LocalizedDescription));
                    else done.TrySetResult();
                });
            }
            catch (Exception ex)
            {
                Cleanup();
                done.TrySetException(ex);
            }
        });
        web.LoadFileUrl(Foundation.NSUrl.FromFilename(path), Foundation.NSUrl.FromFilename(Path.GetDirectoryName(path)!));
        return done.Task;

        void Cleanup()
        {
            web.RemoveFromSuperview();
            if (_web == web) _web = null;
        }
    }

    sealed class LoadedDelegate(Action<bool> loaded) : WebKit.WKNavigationDelegate
    {
        bool _fired;
        void Fire(bool ok) { if (_fired) return; _fired = true; loaded(ok); }
        public override void DidFinishNavigation(WebKit.WKWebView webView, WebKit.WKNavigation navigation) => Fire(true);
        public override void DidFailNavigation(WebKit.WKWebView webView, WebKit.WKNavigation navigation, Foundation.NSError error) => Fire(false);
        public override void DidFailProvisionalNavigation(WebKit.WKWebView webView, WebKit.WKNavigation navigation, Foundation.NSError error) => Fire(false);
    }
#endif

    public static async Task PrintPdfAsync(string path)
    {
        if (!File.Exists(path)) throw new FileNotFoundException("The print file was not created.", path);
#if MACCATALYST
        await MainThread.InvokeOnMainThreadAsync(() => PrintInHiddenWebView(path));
#elif WINDOWS
        try
        {
            // The "print" verb sends the file to the default PDF app's print command.
            System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(path) { UseShellExecute = true, Verb = "print" });
        }
        catch (System.ComponentModel.Win32Exception)
        {
            // No app registered a print command for PDF: open it so the user can print from the viewer.
            await Launcher.Default.OpenAsync(new OpenFileRequest(Path.GetFileName(path), new ReadOnlyFile(path)));
        }
#else
        await Launcher.Default.OpenAsync(new OpenFileRequest(Path.GetFileName(path), new ReadOnlyFile(path)));
#endif
    }
}
