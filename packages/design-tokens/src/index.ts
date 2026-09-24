/**
 * @da/design-tokens — the single source of the Dijital Asistan visual language (PRIMARY design,
 * DESIGN_AUDIT §2). React Native imports this typed object; web and backoffice import the
 * generated `@da/design-tokens/tokens.css`; widgets use the generated native colour sources.
 * Pure TypeScript with relative `.ts` imports and no runtime dependencies.
 */
export * from './palette.ts';
export * from './color.ts';
export * from './contrast.ts';
export * from './contrast-pairs.ts';
export * from './gradient.ts';
export * from './typography.ts';
export * from './space.ts';
export * from './layout.ts';
export * from './size.ts';
export * from './radius.ts';
export * from './shadow.ts';
export * from './motion.ts';
export * from './opacity.ts';
export * from './z.ts';
export * from './aliases.ts';
