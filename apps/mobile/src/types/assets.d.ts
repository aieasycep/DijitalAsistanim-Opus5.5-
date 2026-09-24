// Metro resolves image imports to an asset reference accepted by `<Image source>`.
declare module '*.png' {
  const asset: number;
  export default asset;
}
