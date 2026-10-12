import { useState } from 'react';
import { getCorePlanAssetTypes } from '@modules/plans/domain/asset-metadata';
import type { ImportSession } from '@modules/import/domain/import-model';
import { FieldAliasSuggestionStrategy } from '@modules/mapping/application/strategies/field-alias-strategy';
import { suggestWithFallback } from '@modules/mapping/application/suggestion-engine';
import type { SuggestedAsset } from '@modules/mapping/domain/suggestion';

function suggestionKey(suggestion: SuggestedAsset): string {
  return `${suggestion.fromNodeId}:${suggestion.type}`;
}

export function useMappingSuggestions(
  session: ImportSession,
  onApplySuggestion: (suggestion: SuggestedAsset) => void,
) {
  const [suggestions, setSuggestions] = useState<SuggestedAsset[]>([]);
  const [selectedSuggestionKeys, setSelectedSuggestionKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const suggest = (nodeIds: string[]) => {
    const found = suggestWithFallback([new FieldAliasSuggestionStrategy()], {
      session,
      nodeIds,
      knownAssetTypes: new Set(getCorePlanAssetTypes()),
    });
    setSuggestions(found);
    setSelectedSuggestionKeys(new Set(found.map(suggestionKey)));
  };
  const dismiss = () => {
    setSuggestions([]);
    setSelectedSuggestionKeys(new Set());
  };
  const toggle = (suggestion: SuggestedAsset) =>
    setSelectedSuggestionKeys((current) => {
      const key = suggestionKey(suggestion);
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const apply = () => {
    suggestions.forEach((suggestion) => {
      if (selectedSuggestionKeys.has(suggestionKey(suggestion))) onApplySuggestion(suggestion);
    });
    setSuggestions((current) =>
      current.filter((suggestion) => !selectedSuggestionKeys.has(suggestionKey(suggestion))),
    );
    setSelectedSuggestionKeys(new Set());
  };
  return { suggestions, selectedSuggestionKeys, suggest, dismiss, toggle, apply };
}
