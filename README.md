# AJxCAD

AJxCAD is a focused 2D CAD workspace for macOS and Windows, built with .NET MAUI and Blazor Hybrid.

Create precise 2D line drawings in a clean workspace designed for quick drafting and easy navigation.

## Drawing and editing

Draw connected lines on an adaptive grid; press Space to end a chain and start a new one, or uncheck **Multi** in the Line toolmenu to draw one line at a time. Points snap to grid intersections and existing endpoints, while a live length label helps you see dimensions as you draw. Select and adjust line ends; while dragging, a dashed guide and live offset distance show the move from its starting point in your chosen measurement units. Undo drawing edits when needed.

The bottom-center toolmenu shows options for the active tool. In Select, switch between Nodes and Lines: click a line in Lines mode to select both ends, including shared corners. Every line with both ends selected is highlighted. Shift-click adds or toggles selection; drag a selected node or line to move the selection together. Rectangle selection continues to select enclosed line ends in either mode. In Lines mode, each selected line shows a diamond handle at its middle: drag it to split the line in two and move the new shared node (one undo restores the original line). Turn the handles off with the Middle checkbox in the Options bar, shown beside the toolmenu in Lines mode.

Click a corner where several lines meet (Nodes mode) to open the **Corner** box. It lists every line end at that corner (L1, L2, …) with its length and far end, and the same labels appear on the board next to each line. Uncheck lines to leave them in place: only checked ends are selected and move, so you can pull one line off a shared corner. Press Done (Space) or Esc to close the box.

While anything is selected, an Actions menu appears beside the toolmenu. **Move** opens a guide box: click a base point (such as a corner of the selection), press Next (or Space), then click the destination. The selection moves by that offset, with a live preview and offset distance; Esc or Cancel stops the move.

## Measuring

Press R for the Ruler. Click two points to see a box with the distance, the x and y difference, and both points' coordinates. Press **Add points** (or Space) to keep going: each click adds a point to the total length, and from three points the enclosed area is shaded, with its size shown at the center of the shape and the angle between the lines marked at every corner. Press the red **Stop** (or Space) to finish and keep the result. The next click hides the box and starts a new measurement. In the toolmenu, choose **Grid + nodes** to snap to line ends and the grid, or **Nodes only** to ignore the grid and pick only line ends. The ruler never changes the drawing.

## Navigation and scale

Pan and zoom the canvas as you work, or center the view on the origin. Grid spacing adapts to the zoom level. Choose metric or imperial measurements, set a 1:1 reference, and use the scale panel to check the current ratio and measured scale bar.

## Projects

Save and reopen drawings as `.ajx` project files. A project keeps its drawing data, title, measurement settings, reference unit, and current view together, so you can pick up where you left off.

## A workspace that suits you

Choose full visual effects or performance mode for the app's appearance on your computer. The read-only Data Buckets viewer lets you inspect the information stored in the current project.
