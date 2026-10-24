# AJxCAD

AJxCAD is a focused 2D CAD workspace for macOS and Windows, built with .NET MAUI and Blazor Hybrid.

Create precise 2D line drawings in a clean workspace designed for quick drafting and easy navigation.

## Drawing and editing

Draw connected lines on an adaptive grid; press Space to end a chain and start a new one, or uncheck **Multi** in the Line toolmenu to draw one line at a time. Points snap to grid intersections and existing endpoints, while a live length label helps you see dimensions as you draw. Select and adjust line ends; while dragging, a dashed guide and live offset distance show the move from its starting point in your chosen measurement units. Undo drawing edits when needed.

The bottom-center toolmenu shows options for the active tool. In Select, switch between Nodes and Lines: click a line in Lines mode to select both ends, including shared corners. Every line with both ends selected is highlighted. Shift-click adds or toggles selection; drag a selected node or line to move the selection together. Rectangle selection continues to select enclosed line ends in either mode. In Lines mode, each selected line shows a diamond handle at its middle: drag it to split the line in two and move the new shared node (one undo restores the original line). Turn the handles off with the Middle checkbox in the Options bar, shown beside the toolmenu in Lines mode.

Click a corner where several lines meet (Nodes mode) to open the **Corner** box. It lists every line end at that corner (L1, L2, …) with its length and far end, and the same labels appear on the board next to each line. Uncheck lines to leave them in place: only checked ends are selected and move, so you can pull one line off a shared corner. Press Done (Space) or Esc to close the box.

Select also picks saved measurement points (blue circles). Shared-corner and rectangle selections can include both line endpoints and area points; the selection information box shows measurement points as blue checkbox options. Uncheck any points to leave them in place, then drag the selection or use **Actions > Move** to move both kinds together. Only included measurement points are selectable. A selection belonging solely to one measurement shows its length and area without opening the editor. Moves update measurement labels and can be undone.

While anything is selected, an Actions menu appears beside the toolmenu. **Move** opens a guide box: click a base point (such as a corner of the selection), press Next (or Space), then click the destination. The selection moves by that offset, with a live preview and offset distance; Esc or Cancel stops the move.

## Measuring

Press R for the Ruler. Click two points to see a box with the distance, the x and y difference, and both points' coordinates. Press **Add points** (or Space) to keep going: each click adds a point to the total length, and from three points the enclosed area is shaded, with its size shown at the center of the shape and the angle between the lines marked at every corner. Press the red **Stop** (or Space) to finish. Check or uncheck the points to include, then press **Save to board** (or Space) to keep the measurement visible with any tool. Small blue circles mark included points.

Saved measurements live in the **Measurements** (`measures`) bucket and are included when saving the `.ajx` project. With **Select** active, click saved length, area or angle text to switch to Ruler and reopen its information box. Clicking a blue point selects it for movement instead of opening the editor. Point checkbox buttons in the editor update the preview; **Save changes** updates the stored measurement, while **Cancel** or Esc discards the draft. Unchecked points remain available to reselect, and at least two points must be included to save. Save operations can be undone. Measurement points do not automatically follow drawing lines: select both to move them together.

Use the **Show on board** checkboxes to choose **Lengths**, **Angles**, and **Area** independently before saving. They update the preview immediately, and each measurement remembers its own choices. Area controls both the area label and shading; hiding values does not change the calculations in the information box. All three start checked, including for older saved measurements. With all text hidden, use Select to pick only a measurement point, then click the length text in its selection information box to reopen the editor.

Select a saved measurement's blue point, or click its text to open the Ruler editor, to show **Delete measurement** in the Actions bar. It opens an in-app confirmation dialog: choose **Cancel** to keep it or **Delete measurement** to remove only that saved measurement. Closing the dialog or pressing Esc also cancels. Other measurements and drawing lines are unchanged. The button is hidden for unsaved drafts and mixed selections. Cmd/Ctrl + Z restores the deleted measurement.

In the toolmenu, choose **Grid + nodes** to snap to line ends and the grid, or **Nodes only** to ignore the grid and pick only line ends. Ruler annotations do not change the drawing's lines. Without saving, clicking the board after a finished measurement starts a new one.

## Page layout

Press P for the Page tool to lay out print pages. The **Pages** panel opens at the top right. Press **+ Add page**, and a dashed frame follows the cursor; click to place its centre. A frame is a sheet of paper (ISO A5–A0, or US Letter, Legal, Tabloid, ANSI C and ANSI D, portrait or landscape) multiplied by a scale factor, so at 1:50 it covers 50 times the paper size. Larger factors frame more of the drawing. The first page picks a scale that fits about half of the view; later pages reuse the last page's paper and scale.

Click a frame to select it and drag it anywhere on the board. In the panel, click a page name to select it and use its checkboxes to show or hide the frame or set **No select**. Hidden and No select frames cannot be clicked or dragged on the board, but you can still select them by name in the panel to edit them. The page information box sets the name, paper size, orientation and scale (type a factor or pick a preset), previewing the frame as you edit. **Save** (or Space) stores the changes, **Cancel** or Esc goes back to the saved page, **Zoom to** fits the page in the view, and **Delete** removes it. Every change can be undone. Pages are stored in the **Pages** (`pages`) bucket and saved in the `.ajx` project, and visible frames show with every tool.

## Printing and PDF

Choose **File > Print / Export…** (Cmd/Ctrl + P) and pick a page. The app switches to the Paper look while the dialog is open. **Print…** opens the PDF in your default PDF app and opens its print dialog (if it only opens the PDF, print from that app), and **Export PDF…** saves a PDF where you choose. The output is a vector PDF of the drawing lines inside the page frame, on the page's paper size at its scale. Measurements and the grid are not printed.

## Navigation and scale

Pan and zoom the canvas as you work, or center the view on the origin. Grid spacing adapts to the zoom level. Choose metric or imperial measurements, set a 1:1 reference, and use the scale panel to check the current ratio and measured scale bar.

## Projects

Save and reopen drawings as `.ajx` project files. A project keeps its drawing data, title, measurement settings, reference unit, and current view together, so you can pick up where you left off.

## A workspace that suits you

Choose **Full effects**, **Performance**, or **Paper** in App settings. Paper uses a white drawing surface with black and gray lines, measurements, selection highlights, and controls throughout the app, without blur or glows. Your appearance choice is remembered on this computer and does not change project data. The read-only Data Buckets viewer lets you inspect the information stored in the current project.
