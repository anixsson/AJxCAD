# AJxCAD

AJxCAD is a focused 2D CAD workspace for macOS and Windows, built with .NET MAUI and Blazor Hybrid.

The VS Code Mac Catalyst Run tasks build the selected configuration before launching it. After clearing Debug or Release outputs, run the corresponding task again to recreate the app bundle.

Create precise 2D drawings in a clean workspace designed for quick drafting and easy navigation.

In **Data buckets**, **Project** groups project settings, Pages and Layers. **Tools** contains Lines, Shapes, Text, Points, Measurements and Symbols. The Measurement tool keeps its existing `measures` bucket format for compatibility with saved projects.

## Layers

The top-right board panel has **Pages** and **Layers** buttons to switch between tabs. Collapse the whole panel to a small icon with its top-right button. Drag the expanded panel's left edge to adjust its width; the width is saved in app settings and restored next time. The resize edge also supports Left/Right arrow keys when focused.

In Layers, use **+ Add layer**, edit a layer's name directly, and choose its **Active** checkbox to use it for new lines, shapes, text, points and saved measurements (including areas and dimensions). Splitting a line keeps both pieces on the original layer.

Use the select-all icon at the left of a layer row to replace the selection with all lines, shapes, text, points and symbol groups in that visible layer. Page frames and measurements are not included. Select board items, choose the destination as the active layer, then press **Move selection to active**. Selecting any endpoint moves the whole owning item to the layer, not just that point. You can also assign a saved measurement open in the Measurement editor. Adding or renaming a layer keeps the current selection.

Each layer has **Show** and **Print** checkboxes. Turning Show off hides its items and excludes them from picking and snapping. Hidden layers never print. Turning Print off leaves a visible layer on the board but omits it from print preview, printing, and PDF export. Page frames do not belong to layers: they use their own visibility controls and remain available in Print / Export. Printed lines and measurements still follow their layer settings.

Layers are stored in the **Layers** (`layers`) bucket, and board items store their `layerId` in their tool buckets. Existing projects load into a visible, printable **Default** layer. Layer creation, renaming, checkbox changes, and item assignment are undoable. Save the project to keep layer changes on disk.

## Drawing and editing

Draw connected lines on an adaptive grid; press Space to end a chain and start a new one, or uncheck **Multi** in the Line toolmenu to draw one line at a time. Points snap to grid intersections and existing endpoints, while a live length label helps you see dimensions as you draw. Select and adjust line ends; while dragging, a dashed guide and live offset distance show the move from its starting point in your chosen measurement units. To delete lines, select them with **Select** and press **Delete** in the Actions bar, or Delete / Backspace: in Nodes mode every line touching a selected node is removed, in Lines mode the selected lines. Undo drawing edits when needed.

Choose **Circle** (O) and click its centre and radius, or choose **Rectangle** (R) and click two opposite corners; these points snap to grid intersections. After the first click, a live label beside the cursor shows the circle's **Radius** or the rectangle's **Width** and **Height** in the current measurement units. These size labels are placement guides only, not saved or printed annotations. In Select, drag a rectangle around a circle to select it. Rectangles expose four corner nodes that can be dragged to resize them. When a whole rectangle is selected, a small bar handle appears in the middle of each side; drag one to move only that side, changing just the width (left/right) or the height (top/bottom). The side snaps like any other edit and cannot pass the opposite side. Choose **Text** (T), click its grid-snapped anchor, enter up to 240 characters (a live preview appears on the board at its real size, scaling with zoom) and click **Place text**. The text information box then lets you change font size (1–1000 mm using the live slider or number field; the − / + buttons step 10 mm and repeat faster while held), family, bold, italic and underline. With Select active, click saved text to reopen the box; drag the text or its anchor to move it while the box stays open, then save changes or cancel. Shapes and text follow their layer visibility and print settings and are included in PDF export.

The bottom-center toolmenu shows options for the active tool. In Select, switch between Nodes and Lines: click a line in Lines mode to select both ends, including shared corners. Every line with both ends selected is highlighted. Shift-click adds or toggles selection; drag a selected node or line to move the selection together. Rectangle selection continues to select enclosed line ends in either mode. In Lines mode, each selected line shows a diamond handle at its middle: drag it to split the line in two and move the new shared node (one undo restores the original line). Turn the handles off with the Middle checkbox in the Options bar, shown beside the toolmenu in Lines mode.

Click a corner where several lines meet (Nodes mode) to open the **Corner** box. It lists every line end at that corner (L1, L2, …) with its length and far end, and the same labels appear on the board next to each line. Uncheck lines to leave them in place: only checked ends are selected and move, so you can pull one line off a shared corner. Click outside the selection or press Esc to close the box.

Select also picks shapes and text, in addition to saved measurement points (blue circles). Shared-corner and rectangle selections can include both line endpoints and area points; the selection information box shows measurement points as blue checkbox options. Uncheck any points to leave them in place, then drag the selection or use **Actions > Move** to move it together. Only included measurement points are selectable. A selection belonging solely to one measurement shows its length and area without opening the editor. Moves update measurement labels and can be undone.

While anything is selected, an Actions menu appears beside the toolmenu. **Move** opens a guide box: click a base point (such as a corner of the selection), press Next (or Space), then click the destination. The selection moves by that offset, with a live preview and offset distance; Esc or Cancel stops the move.

**Selections** lists every selected item and labels it on the board by type: **L** lines, **C** circles, **R** rectangles, **T** text, **P** points, **S** symbols and **M** measurements (L1, L2, S1, M1, ...). Uncheck an entry to remove that item from the selection; check it again to restore it. Labels stay fixed while the list is open and newly selected items get the next number. Close, Esc or clearing the selection on the board closes the list.

## Symbol imports

Choose **Symbol import** (I), press **Select project**, and choose another `.ajx` file. Its Tools buckets are loaded into an isolated source group and rendered as actual geometry, not as an image. Click the board to place the source project's **(0,0) origin**. Each source coordinate is preserved relative to that origin. Lines, shapes, text, points, measurements and nested symbol references stay separate from the host's own tool buckets.

With **Select**, click the group to open its information box, which shows the source file's full location. Only the whole group can be selected, moved, scaled, assigned to a layer or deleted; source items and their nodes are not selectable or snap targets in the host. The **Scale factor** scales source coordinates around the group's origin (1 preserves drawing size). Placement, movement, scaling, replacement and deletion are undoable.

Use the **- / +** buttons beside Scale factor to decrease or increase the symbol scale by **0.1** per click. The number field still accepts precise positive scale factors; minus is disabled at 0.1 or below to prevent a non-positive step.

Selecting a placed symbol lists the source project's layers under **Show layers**. Check or uncheck a layer to show or hide it in that symbol only; this local choice is saved in the host's Symbols bucket (`sourceLayers`), changes the symbol border and PDF output, supports Undo, and leaves other placements of the same source untouched. **Use source layers** returns to the source's own visibility. If the source project's layer visibility later changes, the local choice keeps overriding it and a **Layers updated** prompt asks whether to use the source layers or keep local; the selected symbol's information box offers the same choice until it is answered.

**Recent symbols** in the Symbol import tool lists the last 10 imported source projects (most recent first) so repeating symbols can be placed again without browsing. It is hidden while a placed symbol is selected. Click an entry to place another copy; **×** removes it from the list. The list is kept in local app preferences, not in the project.

Use **Open source project** to edit the original project separately. A prompt offers to save the host first, open without saving, or cancel; canceling or failing the save keeps the host open. Save source edits there, then reopen the host or press **Refresh** to reload its linked Tools buckets. Opening the host automatically reloads its sources, including nested references. Circular imports are rejected rather than recursed indefinitely.

The host's **Symbols** (`symbols`) bucket stores only each source location, group position, scale, host layer and optional local layer choices (plus its item ID). No source geometry, image or source project settings are embedded in the saved host. Source layer visibility (or the symbol's local layer choice) and point marker settings are respected when rendering; source Print flags do not hide otherwise visible content. The host layer controls visibility and printing of the whole group. PDF output keeps imported geometry vector-based.

Linked imports reload automatically when the host opens, without selecting their source files again. The macOS desktop app disables App Sandbox so linked projects can be read directly across restarts. macOS privacy permissions still apply to protected folders; grant AJxCAD access in System Settings when requested. Mac App Store distribution requires re-enabling App Sandbox.

On macOS, security-scoped source-file bookmarks are also retained to support sandboxed distribution and follow relocated files when macOS can resolve them. Bookmarks stay in local app preferences, not in the project; older bookmarks are upgraded automatically while the source is accessible.

If a source is deleted, cannot be located, is inaccessible or invalid, a crossed **Missing symbol import** placeholder appears. **Select another project** relinks it while preserving the host transform and layer; failed replacements preserve the previous link. On another computer, select the source files again to locate and authorize them.

If macOS cannot retain source access, the selected file still imports and a warning explains that it may need to be selected again after restarting. Importing and relinking use the file picker's readable stream; a bookmark failure does not invalidate the project.

## Measuring

Choose **Measurement** below Line in the left toolbar or press M. The left toolbar contains Cross, Select, Line and Measurement; page controls are in the Pages tab rather than the toolbar. Click two points to see a box with the distance, the x and y difference, and both points' coordinates. Press **Add points** (or Space) to keep going: each click adds a point to the total length, and from three points the enclosed area is shaded, with its size shown at the center of the shape and the angle between the lines marked at every corner. Press the red **Stop** (or Space) to finish. Check or uncheck the points to include, then press **Save to board** (or Space) to keep the measurement visible with any tool. Small blue circles mark included points.

Saved measurements live in the **Measurements** (`measures`) bucket and are included when saving the `.ajx` project. With **Select** active, click saved length, area or angle text to switch to Measurement and reopen its information box. Clicking a blue point selects it for movement instead of opening the editor. Point checkbox buttons in the editor update the preview; **Save changes** updates the stored measurement, while **Cancel** or Esc discards the draft. Unchecked points remain available to reselect, and at least two points must be included to save. Save operations can be undone. Measurement points do not automatically follow drawing lines: select both to move them together.

To continue a finished or reopened area, press **Add points** in the Measurement editor, then click to append points after the last included point. Press **Stop** when finished, then **Save changes** (or **Save to board** for a new measurement). Added points remain a preview until saved; Cancel or Esc discards them, and a saved extension can be undone. CAD dimensions remain two-point measurements and do not offer Add points.

Each point row keeps its coordinates and has a **Delete** button on the right to remove that point from the draft. Save applies the deletion; Cancel discards it. At least two included points are required to save, and saved deletions can be undone.

Use the **Show on board** checkboxes to choose **Lengths**, **Angles**, and **Area** independently before saving. They update the preview immediately, and each measurement remembers its own choices. Area controls both the area label and shading; hiding values does not change the calculations in the information box. All three start checked, including for older saved measurements. With all text hidden, use Select to pick only a measurement point, then click the length text in its selection information box to reopen the editor.

Select a saved measurement's blue point, or click its text to open the Measurement editor, to show **Delete measurement** in the Actions bar. It opens an in-app confirmation dialog: choose **Cancel** to keep it or **Delete measurement** to remove only that saved measurement. Closing the dialog or pressing Esc also cancels. Other measurements and drawing lines are unchanged. The button is hidden for unsaved drafts and mixed selections. Cmd/Ctrl + Z restores the deleted measurement.

In the toolmenu, choose **Grid + nodes** to snap to line ends and the grid, or **Nodes only** to ignore the grid and pick only line ends. Measurement annotations do not change the drawing's lines. Without saving, clicking the board after a finished measurement starts a new one.

A two-point measurement can become a CAD dimension. A blue ring sits in the middle of the measured line: drag it sideways to pull out a dimension line parallel to the measurement, with extension lines from both points, arrows at both ends and the length written along it. The measured line itself is then hidden. Once you start dragging, **Add points** leaves the Measurement box and **Save to board** (Space) keeps the dimension; to keep measuring instead, use **Add points** before dragging. In any action box, Tab and Shift+Tab move the glow to the next or previous button, and Space presses the glowing one. The dimension is stored with the measurement in the **Measurements** bucket, its text reopens the editor where the ring can be dragged again, and Select can drag its blue dot like other measurement points. Dimensions print as they look in Paper, at the page's text size.

## Page layout

Press P for the Page tool to lay out print pages. The **Pages** panel opens at the top right. Press **+ Add page**, and a dashed frame follows the cursor; click to place its centre. A frame is a sheet of paper (ISO A5–A0, or US Letter, Legal, Tabloid, ANSI C and ANSI D, portrait or landscape) multiplied by a scale factor, so at 1:50 it covers 50 times the paper size. Larger factors frame more of the drawing. The first page picks a scale that fits about half of the view; later pages reuse the last page's paper and scale.

Click a frame to select it and drag it anywhere on the board. With the Select tool, clicking a frame's border or name label (where there is no line end or line) switches to the Page tool with that page selected, and you can keep dragging to move it. In the panel, click a page name to select it and use its checkboxes to show or hide the frame or set **No select**. Hidden and No select frames cannot be clicked or dragged on the board, but you can still select them by name in the panel to edit them. The page information box sets the name, paper size, orientation and scale (type a factor or pick a preset), previewing the frame as you edit. **Save** (or Space) stores the changes, **Cancel** or Esc goes back to the saved page, **Zoom to** fits the page in the view, and **Delete** removes it. Every change can be undone. Pages are stored in the **Pages** (`pages`) bucket and saved in the `.ajx` project, and visible frames show with every tool.

Under **Print**, the **Text size** slider (50–400%) sets how large measurement text, angle arcs, area boxes and points print on that page; it is saved with the page. Drawing text keeps its font size in world millimetres and scales with the drawing when printed or exported; this slider does not affect it. **Print preview** switches to the Paper look and draws measurements on the board at the size they will print on the selected page, following the slider and the page scale as you change them. Preview ends when you deselect the page or leave the Page tool.

The page information box also has **Page components**, with at most one **compass** and one **scale ruler** per page. Choose **Add compass**, click inside the selected frame for its centre, then click again to point north. Choose **Add scale ruler** and click inside the frame to place it. **Move compass** repeats both clicks to move it or change north; **Move scale ruler** repositions the ruler. Esc or **Cancel placement** abandons a placement without changing existing components. Components cannot be placed on hidden or No select pages.

Each component has its own **25–400%** size slider, including its text, and a **Remove** button. **Save** applies component edits with the page; **Cancel** discards them, and saved edits are undoable. They are stored with their page in the project, move with its frame, hide when the page is hidden, and are deleted with it. Components are clipped to their own sheet and included in print preview, printing and PDF export. Their sizes are paper sizes, independent of the measurement text slider.

The ruler shows zero, a real drawing distance in the project's measurement units, and the page's print ratio (for example, **Scale 1:50**). Its bar and labels update when the page scale or ruler size changes; changing the ruler size never changes the drawing scale. A 1 m drawing line printed at 1:50 is 20 mm long on paper, matching 1 m on the ruler. Print at **100% / actual size** to preserve the numeric ratio; fitting the PDF to a different paper size changes that ratio, though the graphic ruler still scales with the drawing.

## Printing and PDF

Drawing text prints and exports in black, including when the page contains shaded measurement areas. Font family, bold, italic and underline are preserved.

Choose **File > Print / Export…** (Cmd/Ctrl + P) and pick a page. The app switches to the Paper look while the dialog is open. **Print…** opens the PDF in your default PDF app and opens its print dialog (if it only opens the PDF, print from that app), and **Export PDF…** saves a PDF where you choose. After saving, click the file name to open the PDF, or **Open location** to show it in Finder or Explorer. The output is a vector PDF of the drawing lines, shapes, text and saved measurements inside the page frame, on the page's paper size at its scale. Measurements print in the Paper look and follow their own **Lengths**, **Angles** and **Area** settings. The grid, unsaved measurements are not printed.

## Points

Choose **Point** (N) and click to place a single node, snapping to existing drawing nodes or the grid. Its lightweight canvas vector marker is a circle divided into four quarters, with two opposite quarters red and crosshairs extending beyond the circle. The marker has a fixed screen size rather than growing with zoom. Points follow layer visibility, support selection, movement and deletion, and remain snap targets when their marker is switched off.

Open **File > Project settings > Point markers** for minus/plus buttons controlling a 25–400% size scale in 25% steps (default 100%), and three visibility modes: **Use local settings**, **Force all markers on**, and **Force all markers off**. These project-wide changes apply immediately. Select one point to open its information box, which shows only local point data: X/Y coordinates in millimetres and a **Show marker locally** toggle. Overrides never change local choices; clearing the override in Project settings restores their effect. Point data and marker settings are saved with the project and are undoable.

Project-wide marker settings are stored as `pointScale` and `pointVisibility` in the **Project** (`project`) bucket, not a separate Point settings bucket. Older projects migrate their Point settings into Project when opened. Undoing marker settings leaves the project title, measurement units and saved view unchanged.

Printing and PDF export include only visible markers on printable layers. Their paper size is fixed independently of page scale and the measurement text-size slider: at 100%, the circle diameter is 3.175 mm. Print preview shows that paper size. Point markers retain their red quarters in the Paper appearance.

## Navigation and scale

The small **Snap** box left of the scale panel has two toggles that apply to every tool and are remembered between sessions. **Grid** (on by default) snaps to grid intersections; turn it off to place and move points exactly where you click, while existing nodes still snap. **Mid** shows temporary snap nodes, drawn as cyan triangles, at the middle of every line and at each rectangle side midpoint and centre. These nodes are never saved, printed or exported. **Ref** turns on reference lines. Rest the cursor on any node (a line end, corner, point or midpoint node) for about a second and it is acquired: a small amber plus marks it, and dashed horizontal and vertical guides run through it. While placing or moving, the cursor locks onto a guide it comes near, which brightens. The other axis follows the grid, or the cursor when Grid is off, and two guides snap to their crossing. Up to four nodes can be acquired at once. Resting on an acquired node again releases it, and changing tool clears them all. Guides are temporary and never saved.

Pan and zoom the canvas as you work, or center the view on the origin. Grid spacing adapts to the zoom level. Choose metric or imperial measurements, set a 1:1 reference, and use the scale panel to check the current ratio and measured scale bar.

### Optimize view

At distant zoom levels, view optimization skips drawing objects smaller than **3 CSS screen pixels**: line length, circle diameter, rectangle diagonal, text font height, or measurement extent (including offset dimensions). Fixed-size Point markers and page frames are never hidden by this optimizer. Hidden objects cannot be selected or snapped to; existing selections are cleared for objects that become hidden. Zooming in restores the detail automatically. Objects are not deleted or changed.

An **Optimize view** panel appears when any visible-layer objects fall below the threshold. Uncheck **Hide objects smaller than 3 screen pixels** to render and interact with all objects, or check it again to optimize. The panel remains available while disabled if there are small objects at the current zoom. The checkbox is a session-only view preference, enabled when the workspace starts.

**Print preview, printing, and PDF export always bypass view optimization**, regardless of zoom or checkbox state. Existing layer visibility/Print settings and explicit point-marker visibility still apply; the optimizer never drops printable detail.

## Projects

Save and reopen drawings as `.ajx` project files. A project keeps its drawing data, title, measurement settings, reference unit, and current view together, so you can pick up where you left off.

The title bar shows **(Unsaved)** after the project title when project data differs from the last save. Saving or undoing back to the saved state clears it; panning and zooming alone do not show it.

Closing the window or quitting with unsaved project changes opens **Save before quitting?** Choose **Save** to save and quit, **Don't save** to discard changes and quit, or **Cancel** (also Esc or closing the dialog) to keep working. New projects ask for a save location. Canceling the save picker or a failed save leaves the app open. Unchanged projects close without a prompt; panning and zooming alone do not count as unsaved changes. Apply edits in tool information boxes before quitting to include them in the saved project.

**File > New** and **File > Open** use the same save confirmation before replacing a project with unsaved tool buckets or project settings. **Save** saves the current project and then continues; **Don't save** continues without saving; **Cancel** keeps the current project. Canceling the save picker or a failed save also leaves the current project intact.

The selected page's information box is titled **Page settings**. Expand **Page sizes** to choose a paper format; the collapsed header shows the current format (for example, **ISO A4** or **US Letter**) and paper dimensions. Orientation and scale remain available outside the accordion.

## A workspace that suits you

When drawing or editing a circle, its live radius is shown at the circle centre. Rectangle dimensions are shown separately: width above the horizontal edge's midpoint and height beside the vertical edge's midpoint. These dimensions use the project's measurement units and appear alongside the existing Offset readout during edits; Move previews also show the resulting shape dimensions.

In **File > App settings > Interface size**, use the **− / +** buttons to change **UI scale** from **80% to 140%** or **Text size** from **100% to 160%**, in **10 percentage-point steps**. UI scale resizes menus and controls; Text size enlarges interface text without scaling icons or spacing. Buttons are disabled at each limit. Both apply immediately, work together, and are remembered on this computer. They do not change the drawing canvas, drawing text, measurements, or print/PDF output.

Modal dialogs, tool information boxes, and the floating scale panel widen with text size as well as UI scale. Their widths stay within the available window space.

In **File > App settings**, enable **Extended zoom range** to widen the view from the normal **1:1000–100:1** limits to **1:10000–1000:1**. The current limits are displayed below the checkbox. Turning it off clamps the current view to the normal range. This affects navigation only, not drawing sizes or print page scales. The choice is remembered on this computer.

Use **Grid color** to choose one color for minor and major grid lines; major lines use stronger opacity. **Use theme default** restores the normal colors for the current appearance. A custom color is remembered across launches and appearance changes, including Paper. Origin axes are unchanged, and the grid is never printed or exported.

Under **Debug > Test data**, expand the Line, Circle, Rectangle, Text, Point or Measurement debug accordion to add 1–10,000 items on the active layer. Each section has its own count and spacing controls. Spacing is the approximate distance between successive centres in screen pixels, not a minimum gap. Generated geometry stays inside a 48 px viewport inset. Text varies font families and styles; measurements alternate triangular areas and two-point CAD dimensions. Existing data is kept, and one Undo removes the whole added batch.

Choose **Full effects**, **Performance**, or **Paper** in App settings. Paper uses a white drawing surface with black and gray lines, measurements, selection highlights, and controls throughout the app, without blur or glows; point markers retain their red quarters. Your appearance choice is remembered on this computer and does not change project data. The read-only Data Buckets viewer lets you inspect the information stored in the current project.
