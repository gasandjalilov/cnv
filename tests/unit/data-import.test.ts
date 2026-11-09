import { describe, expect, it } from 'vitest'
import { DataImportError, parseTableFile } from '@core/data-import'

describe('импорт таблиц', () => {
  it('CSV: BOM, кавычки, многострочные ячейки и типы значений', () => {
    const rows = parseTableFile(
      'tests.csv',
      '\uFEFFrun,seconds,passed,note,empty\r\n"первый, быстрый",12.4,true,"готово",\r\n"второй\nмедленный",10.8,false,"сказал ""да""",null\r\n'
    )
    expect(rows).toEqual([
      { run: 'первый, быстрый', seconds: 12.4, passed: true, note: 'готово', empty: null },
      { run: 'второй\nмедленный', seconds: 10.8, passed: false, note: 'сказал "да"', empty: 'null' }
    ])
  })

  it('CSV с точкой с запятой понимает десятичную запятую', () => {
    expect(parseTableFile('tests.csv', 'run;seconds;ok\nпервый;12,4;true\n')).toEqual([
      { run: 'первый', seconds: 12.4, ok: true }
    ])
  })

  it('TSV использует табуляцию', () => {
    expect(parseTableFile('tests.tsv', 'run\tseconds\nпервый\t10.8\n')).toEqual([
      { run: 'первый', seconds: 10.8 }
    ])
  })

  it('пустые и повторные заголовки получают уникальные имена', () => {
    expect(parseTableFile('tests.csv', 'value,,value\n1,2,3\n')).toEqual([
      { value: 1, 'column 2': 2, value_2: 3 }
    ])
  })

  it('JSON принимает массив и объект с rows', () => {
    expect(parseTableFile('tests.json', '[{"name":"тесты","value":42}]')).toEqual([
      { name: 'тесты', value: 42 }
    ])
    expect(parseTableFile('tests.json', '{"rows":[{"name":"тесты","value":42}]}')).toEqual([
      { name: 'тесты', value: 42 }
    ])
  })

  it('понятные ошибки формата', () => {
    expect(() => parseTableFile('tests.csv', 'a,b\n"незакрыто,1')).toThrow(DataImportError)
    expect(() => parseTableFile('tests.xlsx', '')).toThrow('CSV, TSV или JSON')
    expect(() => parseTableFile('tests.json', '{}')).toThrow('массив')
  })
})
