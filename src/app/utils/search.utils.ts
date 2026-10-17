import { distinctUntilChanged, filter, map, pipe } from 'rxjs';

export const MIN_SEARCH_LENGTH = 2;

/** Ignore incomplete terms; clearing the input resets the search. */
export function searchTerms() {
  return pipe(
    map((value: string) => value.trim()),
    filter((value) => value.length === 0 || value.length >= MIN_SEARCH_LENGTH),
    distinctUntilChanged(),
  );
}
