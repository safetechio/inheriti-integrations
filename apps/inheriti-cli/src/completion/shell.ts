/**
 * The scripts a shell sources to get candidates from the CLI itself.
 *
 * Each one calls `inheriti __complete` with the words typed so far and reads back
 * `value<TAB>description` lines. Nothing is hard-coded here: a new completable argument is a change
 * in `__complete` alone, and every installed script keeps working.
 */
export const COMPLETION_SHELLS = ['bash', 'zsh', 'fish'] as const;
export type CompletionShell = (typeof COMPLETION_SHELLS)[number];

const BASH = `# inheriti completion for bash
_inheriti_complete() {
  local candidates
  candidates="$(inheriti __complete "\${COMP_WORDS[@]:1:COMP_CWORD}" 2>/dev/null | cut -f1)"
  COMPREPLY=($(compgen -W "\${candidates}" -- "\${COMP_WORDS[COMP_CWORD]}"))
}
complete -F _inheriti_complete inheriti
`;

const ZSH = `#compdef inheriti
# inheriti completion for zsh
_inheriti() {
  local -a candidates
  candidates=("\${(@f)$(inheriti __complete "\${words[@]:1:$((CURRENT-1))}" 2>/dev/null | sed 's/\\t/:/')}")
  _describe -t candidates 'inheriti' candidates
}
compdef _inheriti inheriti
`;

const FISH = `# inheriti completion for fish
function __inheriti_complete
  set -l tokens (commandline -opc) (commandline -ct)
  inheriti __complete $tokens[2..-1] 2>/dev/null
end
complete -c inheriti -f -a "(__inheriti_complete)"
`;

export function completionScript(shell: CompletionShell): string {
  if (shell === 'zsh') return ZSH;
  if (shell === 'fish') return FISH;
  return BASH;
}
