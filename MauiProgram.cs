using CommunityToolkit.Maui;
using Microsoft.Extensions.Logging;

namespace AJxCAD;

public static class MauiProgram
{
	public static MauiApp CreateMauiApp()
	{
		var builder = MauiApp.CreateBuilder();
		builder
			.UseMauiApp<App>()
			.UseMauiCommunityToolkit()
			.ConfigureFonts(fonts =>
			{
				fonts.AddFont("OpenSans-Regular.ttf", "OpenSansRegular");
			});

		builder.Services.AddMauiBlazorWebView();

		// Hide the OS title bar and its buttons; the app draws its own (see NativeWindow).
		Microsoft.Maui.Handlers.WindowHandler.Mapper.AppendToMapping("NoTitleBar", (handler, view) =>
		{
			MainThread.BeginInvokeOnMainThread(async () =>
			{
				await Task.Delay(200);
				NativeWindow.HideChrome();
			});
		});

#if MACCATALYST
		// The WKWebView only receives key events while it is the first responder, and macOS drops that
		// whenever the app is deactivated or focus moves. Re-assert it whenever it has been lost.
		Microsoft.AspNetCore.Components.WebView.Maui.BlazorWebViewHandler.BlazorWebViewMapper.AppendToMapping("KeyboardFocus", (handler, view) =>
		{
			var webView = handler.PlatformView;
			// Let the page fill the whole window, including the area under the old title bar.
			webView.ScrollView.ContentInsetAdjustmentBehavior = UIKit.UIScrollViewContentInsetAdjustmentBehavior.Never;
			webView.InsetsLayoutMarginsFromSafeArea = false;
			var timer = new System.Timers.Timer(250) { AutoReset = true };
			timer.Elapsed += (_, _) => MainThread.BeginInvokeOnMainThread(() =>
			{
				if (webView.Window is null || UIKit.UIApplication.SharedApplication.ApplicationState != UIKit.UIApplicationState.Active) return;
				if (!webView.Window.IsKeyWindow) webView.Window.MakeKeyWindow();
				if (!webView.IsFirstResponder) webView.BecomeFirstResponder();
			});
			timer.Start();
		});
#endif

#if DEBUG
		builder.Services.AddBlazorWebViewDeveloperTools();
		builder.Logging.AddDebug();
#endif

		return builder.Build();
	}
}
