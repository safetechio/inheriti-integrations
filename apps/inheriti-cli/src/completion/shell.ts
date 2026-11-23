import { CLI_COMMAND } from '../install-identity.js';

/**
 * The scripts a shell sources to get candidates from the CLI itself.
 *
 * Each one calls `inheriti __complete` with the words typed so far and reads back
 * `value<TAB>description` lines. Nothing is hard-coded here: a new completable argument is a change
 * in `__complete` alone, and every installed script keeps working.
 */
export const COMPLETION_SHELLS = ['bash', 'zsh', 'fish'] as const;
export type CompletionShell = (typeof COMPLETION_SHELLS)[number];

const commandIdentifier = CLI_COMMAND.replaceAll('-', '_');

const BASH = `# ${CLI_COMMAND} completion for bash
_${commandIdentifier}_complete() {
  local candidates
  candidates="$(${CLI_COMMAND} __complete "\${COMP_WORDS[@]:1:COMP_CWORD}" 2>/dev/null | cut -f1)"
  COMPREPLY=($(compgen -W "\${candidates}" -- "\${COMP_WORDS[COMP_CWORD]}"))
}
complete -o bashdefault -o default -F _${commandIdentifier}_complete ${CLI_COMMAND}
`;

const ZSH = `#compdef ${CLI_COMMAND}
# ${CLI_COMMAND} completion for zsh
_${commandIdentifier}() {
  local -a candidates
  candidates=("\${(@f)$(${CLI_COMMAND} __complete "\${words[@]:1:$((CURRENT-1))}" 2>/dev/null | sed 's/\\t/:/')}")
  _describe -t candidates '${CLI_COMMAND}' candidates
}
compdef _${commandIdentifier} ${CLI_COMMAND}
`;

const FISH = `# ${CLI_COMMAND} completion for fish
function __${commandIdentifier}_complete
  set -l tokens (commandline -opc) (commandline -ct)
  ${CLI_COMMAND} __complete $tokens[2..-1] 2>/dev/null
end
complete -c ${CLI_COMMAND} -a "(__${commandIdentifier}_complete)"
`;

export function completionScript(shell: CompletionShell): string {
  if (shell === 'zsh') return ZSH;
  if (shell === 'fish') return FISH;
  return BASH;
}
