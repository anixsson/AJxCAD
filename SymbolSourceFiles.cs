namespace AJxCAD;

public static class SymbolSourceFiles
{
    public const int RecentLimit = 10;
    private const string RecentKey = "symbol-recent-sources";

    // Machine-local history of imported source projects, most recent first.
    public static IReadOnlyList<string> Recent()
    {
        try
        {
            return System.Text.Json.JsonSerializer.Deserialize<List<string>>(Preferences.Default.Get(RecentKey, "[]"))?
                .Where(s => !string.IsNullOrWhiteSpace(s)).Take(RecentLimit).ToList() ?? [];
        }
        catch (System.Text.Json.JsonException)
        {
            return [];
        }
    }

    public static IReadOnlyList<string> AddRecent(string source) =>
        SaveRecent(Recent().Where(s => !SamePath(s, source)).Prepend(source));

    public static IReadOnlyList<string> RemoveRecent(string source) =>
        SaveRecent(Recent().Where(s => !SamePath(s, source)));

    private static IReadOnlyList<string> SaveRecent(IEnumerable<string> sources)
    {
        var list = sources.Take(RecentLimit).ToList();
        Preferences.Default.Set(RecentKey, System.Text.Json.JsonSerializer.Serialize(list));
        return list;
    }

    private static bool SamePath(string a, string b) =>
        string.Equals(Path.GetFullPath(a), Path.GetFullPath(b),
            OperatingSystem.IsWindows() || OperatingSystem.IsMacCatalyst() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal);

    public static string? RememberAccess(string source)
    {
#if MACCATALYST
        using var url = Foundation.NSUrl.FromFilename(source);
        var accessed = url.StartAccessingSecurityScopedResource();
        try
        {
            return SaveBookmark(source, url);
        }
        finally
        {
            if (accessed) url.StopAccessingSecurityScopedResource();
        }
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
            var text = await File.ReadAllTextAsync(source);
            // Upgrade older bookmarks while the file is still accessible.
            if (RememberAccess(source) is { } warning) warn(warning);
            return text;
        }
        catch (Exception ex) when (saved.Length > 0 && ex is IOException or UnauthorizedAccessException)
        {
            warn($"Direct source access failed; restoring its saved bookmark: {ex.Message}");
        }
        if (saved.Length > 0)
        {
            using var data = Foundation.NSData.FromArray(Convert.FromBase64String(saved));
            using var url = Foundation.NSUrl.FromBookmarkData(data,
                Foundation.NSUrlBookmarkResolutionOptions.WithoutUI |
                SecurityScopedResolution,
                null, out var stale, out var error);
            if (url is null || error is not null)
                throw new IOException($"Could not restore source access: {error?.LocalizedDescription ?? source}");
            var accessed = url.StartAccessingSecurityScopedResource();
            try
            {
                if (stale && SaveBookmark(source, url) is { } warning) warn(warning);
                if (!url.IsFileUrl || string.IsNullOrWhiteSpace(url.Path))
                    throw new IOException($"The saved source bookmark does not resolve to a file: {source}");
                return await File.ReadAllTextAsync(url.Path);
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
    // Apple's SDK supports these flags on Mac Catalyst 13+, but the .NET enum annotations omit it.
#pragma warning disable CA1416
    private const Foundation.NSUrlBookmarkCreationOptions SecurityScopedCreation =
        Foundation.NSUrlBookmarkCreationOptions.WithSecurityScope;
    private const Foundation.NSUrlBookmarkResolutionOptions SecurityScopedResolution =
        Foundation.NSUrlBookmarkResolutionOptions.WithSecurityScope;
#pragma warning restore CA1416

    private static string BookmarkKey(string source) =>
        "symbol-source-" + Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(source)));

    private static string? SaveBookmark(string source, Foundation.NSUrl url)
    {
        // Keep the sandbox grant on this machine, never inside a shared project file.
        using var data = url.CreateBookmarkData(
            SecurityScopedCreation,
            null, null, out var error);
        if (data is null || error is not null)
            return $"The selected project can be imported, but macOS could not retain source access: {error?.LocalizedDescription ?? source}. You may need to select the source again after restarting the app.";
        Preferences.Default.Set(BookmarkKey(source), Convert.ToBase64String(data.ToArray()));
        return null;
    }
#endif
}
