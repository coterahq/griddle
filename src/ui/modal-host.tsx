import * as React from 'react';

export type DataGridModalPage = {
  view: () => React.ReactNode;
  /** Chrome is the host's to render; the grid only says what it is. */
  title: string;
  subtitle?: string;
  onClose: () => void;
};

export type DataGridModalHost = {
  push(page: DataGridModalPage): void;
  /** Pops the top page. */
  pop(): void;
};

const ModalHostContext = React.createContext<DataGridModalHost | null>(null);

/**
 * Lets a host route the grid's dialogs into its own modal stack.
 *
 * Inverted from the original, which reached out to the app's modal manager and
 * fell back to a self-hosted dialog when there wasn't one. Same two outcomes,
 * but the dependency now points inward: an app with a modal system supplies an
 * adapter, and an app without one does nothing and gets a plain dialog.
 *
 * `null` — the default — is the standalone path.
 */
export function useDataGridModalHost(): DataGridModalHost | null {
  return React.useContext(ModalHostContext);
}

export function DataGridModalHostProvider({
  host,
  children,
}: {
  host: DataGridModalHost | null;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <ModalHostContext.Provider value={host}>
      {children}
    </ModalHostContext.Provider>
  );
}
