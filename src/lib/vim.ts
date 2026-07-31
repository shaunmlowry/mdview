import { Vim } from "@replit/codemirror-vim";

type FilterText = (command: string, input: string) => Promise<string>;

export function registerVimWriteCommand(save: () => void): void {
  Vim.defineEx("write", "w", save);
}

export function registerVimFilterOperator(
  filterText: FilterText,
  reportError: (message: string) => void,
): void {
  Vim.defineOperator("shellFilter", (cm, _operatorArgs, ranges, oldAnchor) => {
    const [{ anchor, head }] = ranges;
    const input = cm.getRange(anchor, head);
    const prompt = document.createElement("label");
    const commandInput = document.createElement("input");

    prompt.className = "vim-command-prompt";
    prompt.append("!", commandInput);
    cm.openDialog(
      prompt,
      (command: string) => {
        if (!command.trim()) return;

        void filterText(command, input)
          .then((output) => cm.replaceRange(output, anchor, head))
          .catch((error) => reportError(error instanceof Error ? error.message : String(error)));
      },
      { bottom: true },
    );

    return oldAnchor;
  });
  Vim.mapCommand("!", "operator", "shellFilter", {}, { isEdit: true });
}
