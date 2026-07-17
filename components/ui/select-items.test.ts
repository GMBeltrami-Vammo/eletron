import { describe, expect, it } from "vitest";
import { createElement as h, type FunctionComponent } from "react";

import { collectSelectItems, SELECT_ITEM_DISPLAY_NAME } from "./select-items";

// Stand-ins for the real components (the .tsx can't be imported under Next's
// jsx:preserve). Only the SelectItem stand-in carries the identifying
// displayName the collector keys on.
const Item: FunctionComponent<{ value?: unknown; children?: unknown }> = () => null;
Item.displayName = SELECT_ITEM_DISPLAY_NAME;
const Content: FunctionComponent<{ children?: unknown }> = () => null;
const Group: FunctionComponent<{ children?: unknown }> = () => null;
const Other: FunctionComponent<{ children?: unknown }> = () => null;

describe("collectSelectItems", () => {
  it("maps each SelectItem value → its label children", () => {
    const children = [
      h(Other, { key: "t" }),
      h(
        Content,
        { key: "c" },
        h(Item, { value: "aluguel" }, "Aluguel"),
        h(Item, { value: "energia" }, "Energia"),
        h(Item, { value: "aluguel_energia" }, "Aluguel e energia"),
      ),
    ];
    expect(collectSelectItems(children)).toEqual({
      aluguel: "Aluguel",
      energia: "Energia",
      aluguel_energia: "Aluguel e energia",
    });
  });

  it("descends into groups and ignores non-item nodes", () => {
    const children = h(
      Content,
      null,
      h(Group, null, h(Other, null, "Enel"), h(Item, { value: "enel:1" }, "Instalação 1")),
      h(Item, { value: "edp:2" }, "UC 2"),
    );
    expect(collectSelectItems(children)).toEqual({
      "enel:1": "Instalação 1",
      "edp:2": "UC 2",
    });
  });

  it("does not descend into a SelectItem's own children", () => {
    const label = h("span", null, "Débito automático");
    const children = h(Content, null, h(Item, { value: "da" }, label));
    expect(collectSelectItems(children)).toEqual({ da: label });
  });

  it("skips non-string values and empty trees", () => {
    expect(collectSelectItems(null)).toEqual({});
    expect(collectSelectItems(h(Content, null, h(Item, { value: 5 }, "x")))).toEqual({});
  });
});
