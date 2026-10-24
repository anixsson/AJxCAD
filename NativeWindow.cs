namespace AJxCAD;

// Native window commands for the app's own title bar. The OS title bar and its buttons are hidden
// (see MauiProgram), so close, minimise, maximise and dragging are done here.
public static class NativeWindow
{
    public static bool IsMac => OperatingSystem.IsMacCatalyst();

    public static void Close() => Application.Current?.Quit();

#if MACCATALYST
    const string ObjC = "/usr/lib/libobjc.dylib";

    [System.Runtime.InteropServices.DllImport(ObjC, EntryPoint = "objc_msgSend")]
    private static extern IntPtr Send(IntPtr receiver, IntPtr selector);

    [System.Runtime.InteropServices.DllImport(ObjC, EntryPoint = "objc_msgSend")]
    private static extern IntPtr SendPtr(IntPtr receiver, IntPtr selector, IntPtr arg);

    [System.Runtime.InteropServices.DllImport(ObjC, EntryPoint = "objc_msgSend")]
    private static extern IntPtr SendIndex(IntPtr receiver, IntPtr selector, nuint index);

    [System.Runtime.InteropServices.DllImport(ObjC, EntryPoint = "objc_msgSend")]
    private static extern void SendBool(IntPtr receiver, IntPtr selector, bool value);

    [System.Runtime.InteropServices.DllImport(ObjC, EntryPoint = "objc_msgSend")]
    private static extern void SendNuint(IntPtr receiver, IntPtr selector, nuint value);

    [System.Runtime.InteropServices.DllImport(ObjC, EntryPoint = "objc_msgSend")]
    private static extern nuint SendReturnNuint(IntPtr receiver, IntPtr selector);

    [System.Runtime.InteropServices.DllImport(ObjC, EntryPoint = "objc_msgSend")]
    private static extern void SendDouble(IntPtr receiver, IntPtr selector, double value);

    [System.Runtime.InteropServices.DllImport(ObjC, EntryPoint = "objc_msgSend")]
    private static extern void SendVoid(IntPtr receiver, IntPtr selector);

    static IntPtr Sel(string name) => ObjCRuntime.Selector.GetHandle(name);

    static IntPtr NsApp() => Send(ObjCRuntime.Class.GetHandle("NSApplication"), Sel("sharedApplication"));

    static IntPtr MainNsWindow()
    {
        var key = Send(NsApp(), Sel("keyWindow"));
        if (key != IntPtr.Zero) return key;
        var windows = Send(NsApp(), Sel("windows"));
        return SendReturnNuint(windows, Sel("count")) > 0 ? SendIndex(windows, Sel("objectAtIndex:"), 0) : IntPtr.Zero;
    }

    // Full-size content under a transparent, title-less bar, and the traffic lights hidden.
    public static void HideChrome()
    {
        var windows = Send(NsApp(), Sel("windows"));
        var count = SendReturnNuint(windows, Sel("count"));
        for (nuint i = 0; i < count; i++)
        {
            var window = SendIndex(windows, Sel("objectAtIndex:"), i);
            const nuint fullSizeContentView = 1 << 15;
            const nuint titled = 1;
            var mask = SendReturnNuint(window, Sel("styleMask"));
            SendNuint(window, Sel("setStyleMask:"), (mask | fullSizeContentView) & ~titled);
            SendBool(window, Sel("setTitlebarAppearsTransparent:"), true);
            // Without the titled style the window is square; round the content layer instead.
            SendBool(window, Sel("setOpaque:"), false);
            SendPtr(window, Sel("setBackgroundColor:"), Send(ObjCRuntime.Class.GetHandle("NSColor"), Sel("clearColor")));
            SendBool(window, Sel("setHasShadow:"), true);
            var cv = Send(window, Sel("contentView"));
            if (cv != IntPtr.Zero)
            {
                SendBool(cv, Sel("setWantsLayer:"), true);
                var layer = Send(cv, Sel("layer"));
                if (layer != IntPtr.Zero)
                {
                    SendDouble(layer, Sel("setCornerRadius:"), 12.0);
                    SendBool(layer, Sel("setMasksToBounds:"), true);
                }
            }
            SendVoid(window, Sel("invalidateShadow"));
            SendNuint(window, Sel("setTitleVisibility:"), 1); // NSWindowTitleHidden
            // The native title bar container still blurs and swallows the mouse over our bar; hide it.
            var content = Send(window, Sel("contentView"));
            var frame = content == IntPtr.Zero ? IntPtr.Zero : Send(content, Sel("superview"));
            if (frame != IntPtr.Zero)
            {
                var subs = Send(frame, Sel("subviews"));
                var n = SendReturnNuint(subs, Sel("count"));
                for (nuint s = 0; s < n; s++)
                {
                    var v = SendIndex(subs, Sel("objectAtIndex:"), s);
                    if (v != content) SendBool(v, Sel("setHidden:"), true);
                }
            }
            for (nuint button = 0; button < 3; button++) // close, miniaturize, zoom
            {
                var b = SendIndex(window, Sel("standardWindowButton:"), button);
                if (b != IntPtr.Zero) SendBool(b, Sel("setHidden:"), true);
            }
        }
    }

    public static void Minimize()
    {
        var w = MainNsWindow();
        if (w != IntPtr.Zero) SendPtr(w, Sel("miniaturize:"), IntPtr.Zero);
    }

    public static void ToggleMaximize()
    {
        var w = MainNsWindow();
        if (w != IntPtr.Zero) SendPtr(w, Sel("zoom:"), IntPtr.Zero);
    }

    // Hands the mouse press that is being processed over to the OS, which then moves the window.
    public static void BeginDrag()
    {
        var w = MainNsWindow();
        var e = Send(NsApp(), Sel("currentEvent"));
        if (w != IntPtr.Zero && e != IntPtr.Zero) SendPtr(w, Sel("performWindowDragWithEvent:"), e);
    }
#elif WINDOWS
    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern bool ReleaseCapture();

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);

    static Microsoft.UI.Xaml.Window? PlatformWindow =>
        Application.Current?.Windows.FirstOrDefault()?.Handler?.PlatformView as Microsoft.UI.Xaml.Window;

    public static void HideChrome()
    {
        var presenter = PlatformWindow?.AppWindow.Presenter as Microsoft.UI.Windowing.OverlappedPresenter;
        presenter?.SetBorderAndTitleBar(true, false); // keep the resize border, drop the title bar and buttons
    }

    public static void Minimize() =>
        (PlatformWindow?.AppWindow.Presenter as Microsoft.UI.Windowing.OverlappedPresenter)?.Minimize();

    public static void ToggleMaximize()
    {
        if (PlatformWindow?.AppWindow.Presenter is not Microsoft.UI.Windowing.OverlappedPresenter p) return;
        if (p.State == Microsoft.UI.Windowing.OverlappedPresenterState.Maximized) p.Restore();
        else p.Maximize();
    }

    public static void BeginDrag()
    {
        var hwnd = WinRT.Interop.WindowNative.GetWindowHandle(PlatformWindow);
        ReleaseCapture();
        SendMessage(hwnd, 0x00A1 /* WM_NCLBUTTONDOWN */, (IntPtr)2 /* HTCAPTION */, IntPtr.Zero);
    }
#else
    public static void HideChrome() { }
    public static void Minimize() { }
    public static void ToggleMaximize() { }
    public static void BeginDrag() { }
#endif
}
