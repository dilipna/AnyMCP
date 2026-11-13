// MV3 forbids eval/new Function in extension pages. Zod can JIT-compile parsers with `new Function`;
// force the interpreter path so it never even tries. Import this FIRST in every entry point.
import { z } from "zod";

z.config({ jitless: true });
