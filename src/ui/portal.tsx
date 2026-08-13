import * as React from 'react';

const PortalContainerContext = React.createContext<HTMLElement | null>(null);

/**
 * Where the grid's portalled content (overlays, dialogs, dropdowns) mounts.
 *
 * `null` means `document.body`, which is right for most apps. Supply a
 * container when the host renders the grid inside a subtree that carries
 * theme overrides or a stacking context the portal must stay within — a
 * portal to `document.body` escapes both.
 */
export function useDataGridPortalContainer(): HTMLElement | null {
  return React.useContext(PortalContainerContext);
}

export function DataGridPortalProvider({
  container,
  children,
}: {
  /** Supply explicitly, or omit to use the provider's own wrapper element. */
  container?: HTMLElement | null;
  children: React.ReactNode;
}): React.ReactElement {
  const [selfContainer, setSelfContainer] = React.useState<HTMLElement | null>(
    null
  );
  const resolved = container === undefined ? selfContainer : container;

  return (
    <PortalContainerContext.Provider value={resolved}>
      <div ref={setSelfContainer} className="contents">
        {children}
      </div>
    </PortalContainerContext.Provider>
  );
}
