import { createContext, useContext, useReducer, type Dispatch, type ReactElement, type ReactNode } from 'react';
import type { Action } from './actions.js';
import { appReducer, createInitialState } from './reducer.js';
import type { AppState } from './types.js';

// Two contexts rather than one `{ state, dispatch }` value: dispatch is stable for the app's whole lifetime, so a component that only dispatches (a key handler, a menu row) never re-renders when unrelated state changes.
const AppStateContext = createContext<AppState | undefined>(undefined);
const AppDispatchContext = createContext<Dispatch<Action> | undefined>(undefined);

export function AppStateProvider({ children, cwd }: { readonly children: ReactNode; readonly cwd?: string }): ReactElement {
  const [state, dispatch] = useReducer(appReducer, { cwd }, createInitialState);
  return (
    <AppStateContext value={state}>
      <AppDispatchContext value={dispatch}>{children}</AppDispatchContext>
    </AppStateContext>
  );
}

export function useAppState(): AppState {
  const state = useContext(AppStateContext);
  if (state === undefined) {
    throw new Error('useAppState was called outside AppStateProvider; wrap the tree in <AppStateProvider> (App already does).');
  }
  return state;
}

export function useAppDispatch(): Dispatch<Action> {
  const dispatch = useContext(AppDispatchContext);
  if (dispatch === undefined) {
    throw new Error('useAppDispatch was called outside AppStateProvider; wrap the tree in <AppStateProvider> (App already does).');
  }
  return dispatch;
}
