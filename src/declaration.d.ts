declare module "*.png";

declare module "*.jpg";

declare module "*.gif";

declare module "*.svg";

declare module "*.json" {
  const value: any;
  export default value;
}

declare module "leaflet/dist/images/marker-icon.png" {
  const value: string;
  export default value;
}
