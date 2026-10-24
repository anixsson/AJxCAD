namespace AJxCAD.Components.Panels;

public sealed record LayerRow(int Id, string Name, bool Visible, bool Printable);
public sealed record LayersState(int ActiveId, LayerRow[] Layers);
