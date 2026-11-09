import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Button } from "../../src/components/ui/button";

test("Button preserves an explicitly idle accessibility state", () => {
  const markup = renderToStaticMarkup(Button({ children: "Share", "aria-busy": false }));
  assert.match(markup, /aria-busy="false"/);
  assert.doesNotMatch(markup, /disabled=/);
});

test("Button leaves unspecified busy state absent and preserves explicit true", () => {
  assert.doesNotMatch(renderToStaticMarkup(Button({ children: "Share" })), /aria-busy=/);
  assert.match(renderToStaticMarkup(Button({ children: "Share", "aria-busy": true })), /aria-busy="true"/);
});

test("loading forces busy and disabled, then restores explicit false", () => {
  const busy = Button({ children: "Share", loading: true, "aria-busy": false });
  assert.equal(busy.props["aria-busy"], true);
  assert.equal(busy.props.disabled, true);
  const idle = Button({ children: "Share", loading: false, "aria-busy": false });
  assert.equal(idle.props["aria-busy"], false);
  assert.equal(idle.props.disabled, false);
});
