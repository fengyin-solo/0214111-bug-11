// 仅用于 node:test：项目源码使用 Vite 的无扩展名 ESM 导入，
// Node 原生 ESM 需要显式扩展名，这里把相对路径的无扩展名导入解析到 .js。
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

export async function resolve(specifier, context, nextResolve) {
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.[a-z]+$/i.test(specifier)) {
    try {
      const resolved = new URL(specifier + '.js', context.parentURL)
      if (existsSync(fileURLToPath(resolved))) {
        return nextResolve(pathToFileURL(fileURLToPath(resolved)).href, context)
      }
    } catch {
      // fall through
    }
  }
  return nextResolve(specifier, context)
}
