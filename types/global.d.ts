/// <reference types="@tarojs/taro" />
/// <reference types="@tarojs/components" />

declare const API_BASE_URL: string;

declare module '*.scss' {
  const content: { [className: string]: string };
  export default content;
}

declare module '*.png';
declare module '*.jpg';
declare module '*.jpeg';

declare const definePageConfig: (config: Taro.PageConfig) => Taro.PageConfig;
declare const defineAppConfig: (config: Taro.AppConfig) => Taro.AppConfig;
