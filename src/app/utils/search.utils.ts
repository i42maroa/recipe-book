import { Observable, debounceTime, defer, distinctUntilChanged, filter, map, pipe, startWith } from 'rxjs';

export const MIN_SEARCH_LENGTH = 2;

export function normalizeSearch(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').trim();
}

export function isCompleteSearch(value: string): boolean {
  const length = value.trim().length;
  return length === 0 || length >= MIN_SEARCH_LENGTH;
}

export interface ValueSource<T> { readonly value: T; readonly valueChanges: Observable<T> }

export function controlValues<T>(control: ValueSource<T>): Observable<T> {
  return defer(() => control.valueChanges.pipe(startWith(control.value)));
}

/** Shared recipe search timing; initial/restored values do not wait 300 ms. */
export function recipeSearch(control: ValueSource<string>, initial = control.value.trim()): Observable<string> {
  return defer(() => control.valueChanges.pipe(
    map(value => value.trim()), debounceTime(300), startWith(initial),
  ));
}

/** Ignore incomplete terms; clearing the input resets the search. */
export function searchTerms() {
  return pipe(
    map((value: string) => value.trim()),
    filter(isCompleteSearch),
    distinctUntilChanged(),
  );
}
