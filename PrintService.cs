namespace AJxCAD;

// Hands a PDF file to the operating system's own print session.
public static class PrintService
{
    public static async Task PrintPdfAsync(string path)
    {
        if (!File.Exists(path)) throw new FileNotFoundException("The print file was not created.", path);
#if MACCATALYST
        await MainThread.InvokeOnMainThreadAsync(() =>
        {
            var url = Foundation.NSUrl.FromFilename(path);
            if (!UIKit.UIPrintInteractionController.CanPrint(url))
                throw new InvalidOperationException("This Mac cannot print the PDF file.");
            var controller = UIKit.UIPrintInteractionController.SharedPrintController;
            var info = UIKit.UIPrintInfo.PrintInfo;
            info.JobName = Path.GetFileNameWithoutExtension(path);
            info.OutputType = UIKit.UIPrintInfoOutputType.General;
            controller.PrintInfo = info;
            controller.PrintingItem = url;
            controller.Present(true, (_, _, error) =>
            {
                if (error is not null) System.Diagnostics.Debug.WriteLine($"print failed: {error.LocalizedDescription}");
            });
        });
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
