namespace AJxCAD.Components.Panels;

// Mirrors the state the Page tool sends from wwwroot/cad/tools/page.js.
public sealed record PaperOption(string Id, string Label, string Group);

public sealed record PageRow(int Id, string Name, bool Visible, bool Locked, bool Selected, string Summary);

public sealed record PageDraft(int Id, int Revision, string Name, string Paper, bool Landscape, double Scale, double TextSize, string ScaleLabel,
    string PaperSize, string Width, string Height, string X, string Y, bool Visible, bool Locked);

public sealed record PagesState(PageRow[] Pages, int? SelectedId, bool Placing, bool Preview, bool Dirty, PageDraft? Draft, PaperOption[] Papers);
