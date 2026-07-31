// @vitest-environment jsdom

import { Vim } from "@replit/codemirror-vim";
import { describe, expect, it, vi } from "vitest";
import { registerVimFilterOperator, registerVimWriteCommand } from "./vim";

describe("Vim commands", () => {
  it("routes :write and :w to the document save handler", () => {
    const save = vi.fn();
    const defineEx = vi.spyOn(Vim, "defineEx").mockImplementation(() => undefined);

    registerVimWriteCommand(save);

    expect(defineEx).toHaveBeenCalledWith("write", "w", expect.any(Function));
    const command = defineEx.mock.calls[0][2];
    command({} as never, {} as never);
    expect(save).toHaveBeenCalledOnce();
  });

  it("filters the motion range through a prompted shell command", async () => {
    const filter = vi.fn().mockResolvedValue("formatted\n");
    const reportError = vi.fn();
    const defineOperator = vi.spyOn(Vim, "defineOperator").mockImplementation(() => undefined);
    const mapCommand = vi.spyOn(Vim, "mapCommand").mockImplementation(() => undefined);

    registerVimFilterOperator(filter, reportError);

    expect(mapCommand).toHaveBeenCalledWith(
      "!",
      "operator",
      "shellFilter",
      {},
      { isEdit: true },
    );

    const operator = defineOperator.mock.calls[0][1];
    const replaceRange = vi.fn();
    let submit: ((command: string) => void) | undefined;
    const cm = {
      getRange: vi.fn().mockReturnValue("unformatted\n"),
      openDialog: vi.fn((_template, callback) => {
        submit = callback;
      }),
      replaceRange,
    };
    const range = {
      anchor: { line: 2, ch: 0 },
      head: { line: 3, ch: 0 },
    };

    operator(cm as never, { linewise: true }, [range], range.anchor);
    submit?.("fmt");

    await vi.waitFor(() => {
      expect(filter).toHaveBeenCalledWith("fmt", "unformatted\n");
      expect(replaceRange).toHaveBeenCalledWith("formatted\n", range.anchor, range.head);
    });
    expect(reportError).not.toHaveBeenCalled();
  });
});
