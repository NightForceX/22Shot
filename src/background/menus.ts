export function installContextMenus(): void {
  browser.menus.removeAll().then(() => {
    browser.menus.create({
      id: "ps-root",
      title: "22Shot",
      contexts: ["page", "image", "selection", "editable", "frame"],
    });
    browser.menus.create({
      id: "ps-region",
      parentId: "ps-root",
      title: "Capture selected area",
      contexts: ["page", "image", "selection", "editable", "frame"],
    });
    browser.menus.create({
      id: "ps-visible",
      parentId: "ps-root",
      title: "Capture visible area",
      contexts: ["page", "image", "selection", "editable", "frame"],
    });
    browser.menus.create({
      id: "ps-fullpage",
      parentId: "ps-root",
      title: "Capture full page",
      contexts: ["page", "image", "selection", "editable", "frame"],
    });
    browser.menus.create({
      id: "ps-element",
      parentId: "ps-root",
      title: "Capture element",
      contexts: ["page", "image", "selection", "editable", "frame"],
    });
    browser.menus.create({
      id: "ps-pdf",
      parentId: "ps-root",
      title: "Save webpage as PDF",
      contexts: ["page", "image", "selection", "editable", "frame"],
    });
    browser.menus.create({
      id: "ps-workspace",
      parentId: "ps-root",
      title: "Open screenshot workspace",
      contexts: ["page", "image", "selection", "editable", "frame"],
    });
  });
}
