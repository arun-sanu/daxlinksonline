export type PineConversionResult = {
  buffer: Buffer;
  preview: string;
  fallback: boolean;
  warnings: string[];
};

export type PineConversionInput = {
  pine: string;
};

export { buildPineConversion } from './pine2py.js';
