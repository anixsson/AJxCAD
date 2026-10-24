namespace AJxCAD;

public static class SymbolSourceFiles
{
    public static string? RememberAccess(string source)
    {
#if MACCATALYST
        using var url = Foundation.NSUrl.FromFilename(source);
        return SaveBookmark(source, url);
#else
        return null;
#endif
    }

    public static async Task<string> ReadTextAsync(string source, Action<string> warn)
    {
#if MACCATALYST
        var saved = Preferences.Default.Get(BookmarkKey(source), "");
        try
        {
            return await File.ReadAllTextAsync(source);
        }
        catch (Exception ex) when (saved.Length > 0 && ex is IOException or UnauthorizedAccessException)
        {
            warn($"Direct source access failed; restoring its saved bookmark: {ex.Message}");
        }
        if (saved.Length > 0)
        {
            using var data = Foundation.NSData.FromArray(Convert.FromBase64String(saved));
            using var url = Foundation.NSUrl.FromBookmarkData(data,
                Foundation.NSUrlBookmarkResolutionOptions.WithoutUI,
                null, out var stale, out var error);
            if (url is null || error is not null)
                throw new IOException($"Could not restore source access: {error?.LocalizedDescription ?? source}");
            var accessed = url.StartAccessingSecurityScopedResource();
            try
            {
                if (stale && SaveBookmark(source, url) is { } warning) warn(warning);
                return await File.ReadAllTextAsync(source);
            }
            finally
            {
                if (accessed) url.StopAccessingSecurityScopedResource();
            }
        }
#endif
        return await File.ReadAllTextAsync(source);
    }

#if MACCATALYST
    private static string BookmarkKey(string source) =>
        "symbol-source-" + Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(source)));

    private static string? SaveBookmark(string source, Foundation.NSUrl url)
    {
        // Keep the sandbox grant on this machine, never inside a shared project file.
        using var data = url.CreateBookmarkData(
            Foundation.NSUrlBookmarkCreationOptions.MinimalBookmark,
            null, null, out var error);
        if (data is null || error is not null)
            return $"The selected project can be imported, but macOS could not retain source access: {error?.LocalizedDescription ?? source}. You may need to select the source again after restarting the app.";
        Preferences.Default.Set(BookmarkKey(source), Convert.ToBase64String(data.ToArray()));
        return null;
    }
#endif
}
