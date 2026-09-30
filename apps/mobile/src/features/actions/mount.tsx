/**
 * `SheetHost` calls a registered renderer as a plain function inside its own render, so a renderer
 * that uses hooks would share the host's hook list (and break when the sheet stack changes).
 * `mountSheet` registers the sheet as its own element instead, keeping its hooks isolated.
 */
import type { ReactNode } from 'react';

import type { SheetRenderProps } from '../../providers/SheetHost';

export function mountSheet<P>(
  Sheet: (props: SheetRenderProps<P>) => ReactNode,
): (props: SheetRenderProps<P>) => ReactNode {
  return function MountedSheet(props: SheetRenderProps<P>) {
    return <Sheet {...props} />;
  };
}
