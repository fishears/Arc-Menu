/*
 * Arc Menu: The new applications menu for Gnome 3.
 *
 * Original work: Copyright (C) 2015 Giovanni Campagna
 * Modified work: Copyright (C) 2016-2017 Zorin OS Technologies Ltd.
 * Modified work: Copyright (C) 2017 LinxGem33
 * Modified work: Copyright (C) 2017 Alexander Rüedlinger
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 *
 * Credits:
 * This file is based on code from the Gnome Applications Menu Extension by Giovanni Campagna.
 * Some code was also referenced from the Gnome Places Status Indicator by Giovanni Campagna
 * and Gno-Menu by The Panacea Projects.
 * These extensions can be found at the following URLs:
 * http://git.gnome.org/browse/gnome-shell-extensions/
 * https://github.com/The-Panacea-Projects/Gnomenu
 */

// Import Libraries
const Atk = imports.gi.Atk;
const GMenu = imports.gi.GMenu;
const Lang = imports.lang;
const Shell = imports.gi.Shell;
const St = imports.gi.St;
const Clutter = imports.gi.Clutter;
const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const Gtk = imports.gi.Gtk;
const GLib = imports.gi.GLib;
const AccountsService = imports.gi.AccountsService;
const Gio = imports.gi.Gio;
const Util = imports.misc.util;
const GnomeSession = imports.misc.gnomeSession;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const MW = Me.imports.menuWidgets;
const Gettext = imports.gettext.domain(Me.metadata['gettext-domain']);
const _ = Gettext.gettext;

const appSys = Shell.AppSystem.get_default();

// Menu Layout Enum
const visibleMenus = {
    ALL: 0,
    APPS_ONLY: 1,
    SYSTEM_ONLY: 2
};

// User Home directories
const DEFAULT_DIRECTORIES = [
    GLib.UserDirectory.DIRECTORY_DOCUMENTS,
    GLib.UserDirectory.DIRECTORY_DOWNLOAD,
    GLib.UserDirectory.DIRECTORY_MUSIC,
    GLib.UserDirectory.DIRECTORY_PICTURES,
    GLib.UserDirectory.DIRECTORY_VIDEOS
];


// Aplication menu class
const ApplicationsMenu = new Lang.Class({
    Name: 'ApplicationsMenu',
    Extends: PopupMenu.PopupMenu,

    // Initialize the menu
    _init: function(sourceActor, arrowAlignment, arrowSide, button, settings) {
        this._settings = settings;
        this.parent(sourceActor, arrowAlignment, arrowSide);
        this._button = button;
    },

    // Return that the menu is not empty (used by parent class)
    isEmpty: function() {
	    return false;
    },

    // Handle opening the menu
    open: function(animate) {
        this.parent(animate);
        if (this._settings.get_enum('visible-menus') != visibleMenus.SYSTEM_ONLY) {
            let searchBox = this._button.searchBox;
            searchBox.grabKeyFocus();
        }
    },

    // Handle closing the menu
    close: function(animate) {
        let size = Main.layoutManager.panelBox.height;
        if (this._button.applicationsBox) {
            this._button.selectCategory(null);
            let searchBox = this._button.searchBox;
            searchBox.clear();
        }
        this.parent(animate);
    }
});

// Application Menu Button class (most of the menu logic is here)
var ApplicationsButton = new Lang.Class({
    Name: 'ApplicationsButton',
    Extends: PanelMenu.Button,

    // Initialize the menu
    _init: function(settings) {
        this._settings = settings;
        this.parent(1.0, null, false);
        this._session = new GnomeSession.SessionManager();

        this.setMenu(new ApplicationsMenu(this.actor, 1.0, St.Side.TOP, this, this._settings));
        Main.panel.menuManager.addMenu(this.menu);
        this.actor.accessible_role = Atk.Role.LABEL;

        this._menuButtonWidget = new MW.MenuButtonWidget();
        this.actor.add_actor(this._menuButtonWidget.actor);

        this.actor.name = 'panelApplications';
        this.actor.connect('captured-event', Lang.bind(this, this._onCapturedEvent));
        this.actor.connect('destroy', Lang.bind(this, this._onDestroy));
        this._showingId = Main.overview.connect('showing', Lang.bind(this, function() {
            this.actor.add_accessible_state (Atk.StateType.CHECKED);
        }));
        this._hidingId = Main.overview.connect('hiding', Lang.bind(this, function() {
            this.actor.remove_accessible_state (Atk.StateType.CHECKED);
        }));
        this._applicationsButtons = new Map();
        this.reloadFlag = false;
        this._createLayout();
        this._display();
        this._installedChangedId = appSys.connect('installed-changed', Lang.bind(this, function() {
            if (this.menu.isOpen) {
                this._redisplay();
                this.mainBox.show();
            } else {
                this.reloadFlag = true;
            }
        }));
        this._notifyHeightId = Main.panel.actor.connect('notify::height', Lang.bind(this, function() {
            this._redisplay();
        }));
    },

    toggleMenu: function() {
    	this.menu.toggle();
    },

    getWidget: function() {
        return this._menuButtonWidget;
    },

    // Create a vertical separator
    _createVertSeparator: function() {
        let separator = new St.DrawingArea({
            style_class: 'calendar-vertical-separator',
            pseudo_class: 'highlighted'
        });
        separator.connect('repaint', Lang.bind(this, this._onVertSepRepaint));
        return separator;
    },

    // Destroy the menu button
    _onDestroy: function() {
        Main.overview.disconnect(this._showingId);
        Main.overview.disconnect(this._hidingId);
        Main.panel.actor.disconnect(this._notifyHeightId);
        appSys.disconnect(this._installedChangedId);
    },

    // Handle captured event
    _onCapturedEvent: function(actor, event) {
        if (event.type() == Clutter.EventType.BUTTON_PRESS) {
            if (!Main.overview.shouldToggleByCornerOrButton())
                return true;
        }
        return false;
    },

    // Repaint vertical separator
    _onVertSepRepaint: function(area) {
        let cr = area.get_context();
        let themeNode = area.get_theme_node();
        let [width, height] = area.get_surface_size();
        let stippleColor = themeNode.get_color('-stipple-color');
        let stippleWidth = themeNode.get_length('-stipple-width');
        let x = Math.floor(width/2) + 0.5;
        cr.moveTo(x, 0);
        cr.lineTo(x, height);
        Clutter.cairo_set_source_color(cr, stippleColor);
        cr.setDash([1, 3], 1);
        cr.setLineWidth(stippleWidth);
        cr.stroke();
    },

    // Handle changes in menu open state
    _onOpenStateChanged: function(menu, open) {
       if (open) {
           if (this.reloadFlag) {
               this._redisplay();
               this.reloadFlag = false;
           }
           this.mainBox.show();
       }
       this.parent(menu, open);
    },

    // Redisplay the menu
    _redisplay: function() {
        if (this.applicationsBox)
            this.applicationsBox.destroy_all_children();
        this._display();
    },

    // Load menu category data for a single category
    _loadCategory: function(categoryId, dir) {
        let iter = dir.iter();
        let nextType;
        while ((nextType = iter.next()) != GMenu.TreeItemType.INVALID) {
            if (nextType == GMenu.TreeItemType.ENTRY) {
                let entry = iter.get_entry();
                let id;
                try {
                    id = entry.get_desktop_file_id();
                } catch(e) {
                    continue;
                }
                let app = appSys.lookup_app(id);
                if (app && app.get_app_info().should_show())
                    this.applicationsByCategory[categoryId].push(app);
            } else if (nextType == GMenu.TreeItemType.DIRECTORY) {
                let subdir = iter.get_directory();
                if (!subdir.get_is_nodisplay())
                    this._loadCategory(categoryId, subdir);
            }
        }
    },

    // Load data for all menu categories
    _loadCategories: function() {
        this.applicationsByCategory = {};
        let tree = new GMenu.Tree({ menu_basename: 'applications.menu' });
        tree.load_sync();
        let root = tree.get_root_directory();
        let iter = root.iter();
        let nextType;
        while ((nextType = iter.next()) != GMenu.TreeItemType.INVALID) {
            if (nextType == GMenu.TreeItemType.DIRECTORY) {
                let dir = iter.get_directory();
                if (!dir.get_is_nodisplay()) {
                    let categoryId = dir.get_menu_id();
                    this.applicationsByCategory[categoryId] = [];
                    this._loadCategory(categoryId, dir);
                    if (this.applicationsByCategory[categoryId].length > 0) {
                        let categoryMenuItem = new MW.CategoryMenuItem(this, dir);
                        this.applicationsBox.add_actor(categoryMenuItem.actor);
                    }
                }
            }
        }
    },

    // Load menu place shortcuts
    _loadPlaces: function() {
        let homePath = GLib.get_home_dir();
        let placeInfo = new MW.PlaceInfo(Gio.File.new_for_path(homePath), _("Home"));
        let placeMenuItem = new MW.PlaceMenuItem(this, placeInfo);
        this.rightBox.add_actor(placeMenuItem.actor);
        let dirs = DEFAULT_DIRECTORIES.slice();
        for (let i = 0; i < dirs.length; i++) {
            let path = GLib.get_user_special_dir(dirs[i]);
            if (path == null || path == homePath)
                continue;
            let placeInfo = new MW.PlaceInfo(Gio.File.new_for_path(path));
            let placeMenuItem = new MW.PlaceMenuItem(this, placeInfo);
            this.rightBox.add_actor(placeMenuItem.actor);
        }
    },

    // Scroll to a specific button (menu item) in the applications scroll view
    scrollToButton: function(button) {
        let appsScrollBoxAdj = this.applicationsScrollBox.get_vscroll_bar().get_adjustment();
        let appsScrollBoxAlloc = this.applicationsScrollBox.get_allocation_box();
        let currentScrollValue = appsScrollBoxAdj.get_value();
        let boxHeight = appsScrollBoxAlloc.y2 - appsScrollBoxAlloc.y1;
        let buttonAlloc = button.actor.get_allocation_box();
        let newScrollValue = currentScrollValue;
        if (currentScrollValue > buttonAlloc.y1 - 10)
            newScrollValue = buttonAlloc.y1 - 10;
        if (boxHeight + currentScrollValue < buttonAlloc.y2 + 10)
            newScrollValue = buttonAlloc.y2 - boxHeight + 10;
        if (newScrollValue != currentScrollValue)
            appsScrollBoxAdj.set_value(newScrollValue);
    },

    // Create the menu layout
    _createLayout: function() {
        // Create main menu sections and scroll views
        let section = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(section);
        this.mainBox = new St.BoxLayout({
            vertical: false,
            style_class: 'main-box'
        });
        section.actor.add_actor(this.mainBox);
        this._mainBoxKeyPressId = this.mainBox.connect('key-press-event', Lang.bind(this, this._onMainBoxKeyPress));

        // Left Box
        if(this._settings.get_enum('visible-menus') == visibleMenus.ALL ||
           this._settings.get_enum('visible-menus') == visibleMenus.APPS_ONLY) {
            this.leftBox = new St.BoxLayout({
                vertical: true,
                style_class: 'left-box'
            });
            this.applicationsScrollBox = new St.ScrollView({
                x_fill: true,
                y_fill: false,
                y_align: St.Align.START,
                style_class: 'apps-menu vfade left-scroll-area'
            });
            this.applicationsScrollBox.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.AUTOMATIC);
            let vscroll = this.applicationsScrollBox.get_vscroll_bar();
            vscroll.connect('scroll-start', Lang.bind(this, function() {
                this.menu.passEvents = true;
            }));
            vscroll.connect('scroll-stop', Lang.bind(this, function() {
                this.menu.passEvents = false;
            }));
            this.leftBox.add(this.applicationsScrollBox, {
                expand: true,
                x_fill: true, y_fill: true,
                y_align: St.Align.START
            });

            // Create search box
            this.searchBox = new MW.SearchBox();
            this._firstAppItem = null;
            this._firstApp = null;
            this._tabbedOnce = false;
            this._searchBoxChangedId = this.searchBox.connect('changed', Lang.bind(this, this._onSearchBoxChanged));
            this._searchBoxClearedId = this.searchBox.connect('cleared', Lang.bind(this, this._onSearchBoxCleared));
            this._searchBoxActivateId = this.searchBox.connect('activate', Lang.bind(this, this._onSearchBoxActive));
            this._searchBoxKeyPressId = this.searchBox.connect('key-press-event', Lang.bind(this, this._onSearchBoxKeyPress));
            this._searchBoxKeyFocusInId = this.searchBox.connect('key-focus-in', Lang.bind(this, this._onSearchBoxKeyFocusIn));

            // Add back button to menu
            this.backButton = new MW.BackMenuItem(this);
            this.leftBox.add(this.backButton.actor, {
                expand: false,
                x_fill: true,
                y_fill: false,
                y_align: St.Align.START
            });

            // Add search box to menu
            this.leftBox.add(this.searchBox.actor, {
                expand: false,
                x_fill: true,
                y_fill: false,
                y_align: St.Align.START
            });

            this.applicationsBox = new St.BoxLayout({ vertical: true });
            this.applicationsScrollBox.add_actor(this.applicationsBox);
            this.mainBox.add(this.leftBox, {
                expand: true,
                x_fill: true,
                y_fill: true
            });

            if(this._settings.get_enum('visible-menus') == visibleMenus.ALL) {
                this.mainBox.add(this._createVertSeparator(), {
                    expand: false,
                    x_fill: false,
                    y_fill: true
                });
            }
        }

        // Right Box
        if(this._settings.get_enum('visible-menus') == visibleMenus.ALL ||
           this._settings.get_enum('visible-menus') == visibleMenus.SYSTEM_ONLY) {
            this.rightBox = new St.BoxLayout({
                vertical: true,
                style_class: 'right-box'
            });
            this.actionsBox = new PopupMenu.PopupBaseMenuItem({
                reactive: false,
                can_focus: false
            });

            // Add session buttons to menu
            let logout = new MW.LogoutButton(this);
            this.actionsBox.actor.add(logout.actor, {
                expand: true,
                x_fill: false,
                y_align: St.Align.START
            });

            let lock = new MW.LockButton(this);
            this.actionsBox.actor.add(lock.actor, {
                expand: true,
                x_fill: false,
                y_align: St.Align.START
            });

            let suspend = new MW.SuspendButton(this);
            this.actionsBox.actor.add(suspend.actor, {
                expand: true,
                x_fill: false,
                y_align: St.Align.START
            });

            let power = new MW.PowerButton(this);
            this.actionsBox.actor.add(power.actor, {
                expand: true,
                x_fill: false,
                y_align: St.Align.START
            });

            let user = new MW.UserMenuItem(this);
            this.rightBox.add(user.actor, {
                expand: false,
                x_fill: true,
                y_fill: false,
                y_align: St.Align.START
            });

            let separator = new PopupMenu.PopupSeparatorMenuItem();
            this.rightBox.add(separator.actor, {
                expand: false,
                x_fill: true,
                y_fill: false,
                y_align: St.Align.START
            });

            // Add place shortcuts to menu
            this._loadPlaces();
            separator = new PopupMenu.PopupSeparatorMenuItem();
            this.rightBox.add(separator.actor, {
                expand: false,
                x_fill: true,
                y_fill: false,
                y_align: St.Align.START
            });

            // List of shortcuts that will be added to the menu
            let shortcuts = [
                {   label: _("Software"),
                    symbolic: "gnome-software-symbolic",
                    command: "gnome-software" },
                {   label: _("Software"),
                    symbolic: "gnome-software-symbolic",
                    command: "pamac-manager" },
                {   label: _("Settings"),
                    symbolic: "preferences-system-symbolic",
                    command: "gnome-control-center" },
                {   label: _("Manjaro Settings"),
                    symbolic: "preferences-desktop-symbolic",
                    command: "manjaro-settings-manager" },
                {   label: _("Tweaks"),
                    symbolic: "org.gnome.tweaks-symbolic",
                    command: "gnome-tweak-tool" },
                {   label: _("Tweaks"), // Tweak Tool is called Tweaks in GNOME 3.26
                    symbolic: "org.gnome.tweaks-symbolic",
                    command: "gnome-tweaks" },
                {   label: _("Terminal"),
                    symbolic: "utilities-terminal-symbolic",
                    command: "gnome-terminal" }
            ];
            shortcuts.forEach(Lang.bind(this, function(shortcut) {
                if (GLib.find_program_in_path(shortcut.command)) {
                    let shortcutMenuItem = new MW.ShortcutMenuItem(this, shortcut.label, shortcut.symbolic, shortcut.command);
                    this.rightBox.add(shortcutMenuItem.actor, {
                        expand: false,
                        x_fill: true,
                        y_fill: false,
                        y_align: St.Align.START
                    });
                }
            }));

            let activities = new MW.ActivitiesMenuItem(this);
            this.rightBox.add(activities.actor, {
                expand: false,
                x_fill: true,
                y_fill: false,
                y_align: St.Align.START
            });
            separator = new PopupMenu.PopupSeparatorMenuItem();
            this.rightBox.add(separator.actor, {
                expand: false,
                x_fill: true,
                y_fill: false,
                y_align: St.Align.START
            });
            this.rightBox.add(this.actionsBox.actor, {
                expand: true,
                x_fill: true,
                y_fill: false,
                y_align: St.Align.END
            });
            this.mainBox.add(this.rightBox);
        }
    },

    // Handle key press events on the mainBox to support the "type-away-feature"
    _onMainBoxKeyPress: function(mainBox, event) {
        if (!this.searchBox) {
            return Clutter.EVENT_PROPAGATE;
        }
        if (event.has_control_modifier()) {
            this.searchBox.grabKeyFocus();
            return Clutter.EVENT_PROPAGATE;
        }

        let symbol = event.get_key_symbol();
        let key = event.get_key_unicode();

        switch (symbol) {
            case Clutter.KEY_BackSpace:
                if (!this.searchBox.hasKeyFocus()) {
                    this.searchBox.grabKeyFocus();
                    let newText = this.searchBox.getText().slice(0, -1);
                    this.searchBox.setText(newText);
                }
                return Clutter.EVENT_PROPAGATE;
            case Clutter.KEY_Tab:
            case Clutter.KEY_KP_Tab:
            case Clutter.Up:
            case Clutter.KP_Up:
            case Clutter.Down:
            case Clutter.KP_Down:
            case Clutter.Left:
            case Clutter.KP_Left:
            case Clutter.Right:
            case Clutter.KP_Right:
                return Clutter.EVENT_PROPAGATE;
            default:
                if (key.length != 0) {
                    this.searchBox.grabKeyFocus();
                    let newText = this.searchBox.getText() + key;
                    this.searchBox.setText(newText);
                }
        }
        return Clutter.EVENT_PROPAGATE;
    },

    _onSearchBoxKeyPress: function(searchBox, event) {
        let symbol = event.get_key_symbol();
        if (!searchBox.isEmpty() && searchBox.hasKeyFocus()) {
            if (symbol == Clutter.Tab && !this._tabbedOnce) {
                this._firstAppItem.setFakeActive(false);
                this._firstAppItem.grabKeyFocus();
                this._tabbedOnce = true;
                return Clutter.EVENT_STOP;
            } else if (symbol == Clutter.ISO_Left_Tab) {
                this._firstAppItem.setFakeActive(false);
            } else if (symbol == Clutter.Up) {
                this._firstAppItem.setFakeActive(false);
            } else if (symbol == Clutter.Down) {
                this._firstAppItem.setFakeActive(false);
                this._firstAppItem.grabKeyFocus();
                return Clutter.EVENT_STOP;
            }
        }
        return Clutter.EVENT_PROPAGATE;
    },

    _onSearchBoxKeyFocusIn: function(searchBox) {
         if (!searchBox.isEmpty() && this._firstAppItem && !this._tabbedOnce) {
            this._firstAppItem.setFakeActive(true);
        }
    },

    _onSearchBoxChanged: function(searchBox, searchString) {
        // normalize search string
        let pattern = searchString.replace(/^\s+/g, '')
            .replace(/\s+$/g, '')
            .toLowerCase();
        this._tabbedOnce = false;
        if (pattern.length > 0) {
            let appResults = this._listApplications(null, pattern);
            if (appResults.length) {
                this._firstApp = appResults[0];
            }
            if (this._firstAppItem) {
                this._firstAppItem.setFakeActive(false);
            }

            this._clearApplicationsBox();
            this._displayButtons(appResults);

            this._firstAppItem = this._applicationsButtons.get(this._firstApp);
            if (this._firstAppItem) {
                this._firstAppItem.setFakeActive(true);
            }
            this.backButton.actor.show();
        }
    },

    _onSearchBoxCleared: function() {
        this.selectCategory(null);
    },

    _onSearchBoxActive: function() {
        if (this._firstApp) {
            let item = this._applicationsButtons.get(this._firstApp);
            item.activate();
        }
    },

    // Display the menu
    _display: function() {
        this.mainBox.hide();
        if (this._settings.get_enum('visible-menus') != visibleMenus.SYSTEM_ONLY) {
            this._applicationsButtons.clear();
            this._loadCategories();
            this.backButton.actor.hide();
        }
    },

    // Clear the applications menu box
    _clearApplicationsBox: function() {
        let actors = this.applicationsBox.get_children();
        for (let i = 0; i < actors.length; i++) {
            let actor = actors[i];
            this.applicationsBox.remove_actor(actor);
        }
    },

    // Select a category or show category overview if no category specified
    selectCategory: function(dir) {
        this._clearApplicationsBox();
        if (dir) {
            this._displayButtons(this._listApplications(dir.get_menu_id()));
            this.backButton.actor.show();
            this.searchBox.grabKeyFocus();
        }
        else {
            this._loadCategories();
            this.backButton.actor.hide();
            this.searchBox.grabKeyFocus();
        }
    },

    // Display application menu items
    _displayButtons: function(apps) {
        if (apps) {
            for (let i = 0; i < apps.length; i++) {
                let app = apps[i];
                let item = this._applicationsButtons.get(app);
                if (!item) {
                    item = new MW.ApplicationMenuItem(this, app);
                    this._applicationsButtons.set(app, item);
                }
                if (!item.actor.get_parent()) {
                    this.applicationsBox.add_actor(item.actor);
                }
            }
         }
    },

    // Get a list of applications for the specified category or search query
    _listApplications: function(category_menu_id, pattern) {
        let applist;

        // Get applications in a category or all categories
        if (category_menu_id) {
            applist = this.applicationsByCategory[category_menu_id];
        } else {
            applist = [];
            for (let directory in this.applicationsByCategory)
                applist = applist.concat(this.applicationsByCategory[directory]);
        }

        let res; //Results array

        // Get search results based on pattern (query)
        if (pattern) {
            let searchResults = [];
            for (let i in applist) {
                let app = applist[i];
                let info = Gio.DesktopAppInfo.new (app.get_id());
                let match = app.get_name().toLowerCase() + " ";
                if (info.get_display_name()) match += info.get_display_name().toLowerCase() + " ";
                if (info.get_executable()) match += info.get_executable().toLowerCase() + " ";
                if (info.get_keywords()) match += info.get_keywords().toString().toLowerCase() + " ";
                if (app.get_description()) match += app.get_description().toLowerCase();
                let index = match.indexOf(pattern);
                if (index != -1) {
                    searchResults.push([index, app]);
                }
            }

            // Sort results by relevance score
            searchResults.sort(function(a,b) {
                return a[0] > b[0];
            });
            res = searchResults.map(function(value,index) { return value[1]; });
        } else {
            applist.sort(function(a,b) {
                return a.get_name().toLowerCase() > b.get_name().toLowerCase();
            });
            res = applist;
        }
	    return res;
    },

    // Destroy (deactivate) the menu
    destroy: function() {
        if (this._searchBoxClearedId > 0) {
            this.searchBox.disconnect(this._searchBoxClearedId);
            this._searchBoxClearedId = 0;
        }
        if (this._searchBoxChangedId > 0) {
            this.searchBox.disconnect(this._searchBoxChangedId);
            this._searchBoxChangedId = 0;
        }
        if (this._searchBoxActivateId > 0) {
            this.searchBox.disconnect(this._searchBoxActivateId);
            this._searchBoxActivateId = 0;
        }
        if (this._searchBoxKeyPressId > 0) {
            this.searchBox.disconnect(this._searchBoxKeyPressId);
            this._searchBoxKeyPressId = 0;
        }
        if (this._searchBoxKeyFocusInId > 0) {
            this.searchBox.disconnect(this._searchBoxKeyFocusInId);
            this._searchBoxKeyFocusInId = 0;
        }
        if (this._mainBoxKeyPressId > 0) {
            this.mainBox.disconnect(this._mainBoxKeyPressId);
            this._mainBoxKeyPressId = 0;
        }
        this.parent();
    }
});
