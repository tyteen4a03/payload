import type { LibSQLDatabase } from 'drizzle-orm/libsql'
import type { FlattenedField, JoinQuery, SelectMode, SelectType, Where } from 'payload'

import { sql } from 'drizzle-orm'
import { fieldIsVirtual } from 'payload/shared'
import toSnakeCase from 'to-snake-case'

import type { BuildQueryJoinAliases, ChainedMethods, DrizzleAdapter } from '../types.js'
import type { Result } from './buildFindManyArgs.js'

import buildQuery from '../queries/buildQuery.js'
import { getTableAlias } from '../queries/getTableAlias.js'
import { getNameFromDrizzleTable } from '../utilities/getNameFromDrizzleTable.js'
import { jsonAggBuildObject } from '../utilities/json.js'
import { rawConstraint } from '../utilities/rawConstraint.js'
import { chainMethods } from './chainMethods.js'

type TraverseFieldArgs = {
  _locales: Result
  adapter: DrizzleAdapter
  collectionSlug?: string
  currentArgs: Result
  currentTableName: string
  depth?: number
  fields: FlattenedField[]
  joinQuery: JoinQuery
  joins?: BuildQueryJoinAliases
  locale?: string
  path: string
  select?: SelectType
  selectAllOnCurrentLevel?: boolean
  selectMode?: SelectMode
  tablePath: string
  topLevelArgs: Record<string, unknown>
  topLevelTableName: string
  versions?: boolean
  withinLocalizedField?: boolean
  withTabledFields: {
    numbers?: boolean
    rels?: boolean
    texts?: boolean
  }
}

export const traverseFields = ({
  _locales,
  adapter,
  collectionSlug,
  currentArgs,
  currentTableName,
  depth,
  fields,
  joinQuery = {},
  joins,
  locale,
  path,
  select,
  selectAllOnCurrentLevel = false,
  selectMode,
  tablePath,
  topLevelArgs,
  topLevelTableName,
  versions,
  withinLocalizedField = false,
  withTabledFields,
}: TraverseFieldArgs) => {
  fields.forEach((field) => {
    if (fieldIsVirtual(field)) {
      return
    }

    // handle simple relationship
    if (
      depth > 0 &&
      (field.type === 'upload' || field.type === 'relationship') &&
      !field.hasMany &&
      typeof field.relationTo === 'string'
    ) {
      if (field.localized) {
        _locales.with[`${path}${field.name}`] = true
      } else {
        currentArgs.with[`${path}${field.name}`] = true
      }
    }

    switch (field.type) {
      case 'array': {
        const arraySelect = selectAllOnCurrentLevel ? true : select?.[field.name]

        if (select) {
          if (
            (selectMode === 'include' && typeof arraySelect === 'undefined') ||
            (selectMode === 'exclude' && arraySelect === false)
          ) {
            break
          }
        }

        const withArray: Result = {
          columns:
            typeof arraySelect === 'object'
              ? {
                  id: true,
                  _order: true,
                }
              : {
                  _parentID: false,
                },
          orderBy: ({ _order }, { asc }) => [asc(_order)],
          with: {},
        }

        const arrayTableName = adapter.tableNameMap.get(
          `${currentTableName}_${tablePath}${toSnakeCase(field.name)}`,
        )

        if (typeof arraySelect === 'object') {
          if (adapter.tables[arrayTableName]._locale) {
            withArray.columns._locale = true
          }

          if (adapter.tables[arrayTableName]._uuid) {
            withArray.columns._uuid = true
          }
        }

        const arrayTableNameWithLocales = `${arrayTableName}${adapter.localesSuffix}`

        if (adapter.tables[arrayTableNameWithLocales]) {
          withArray.with._locales = {
            columns:
              typeof arraySelect === 'object'
                ? {
                    _locale: true,
                  }
                : {
                    id: false,
                    _parentID: false,
                  },
            with: {},
          }
        }

        currentArgs.with[`${path}${field.name}`] = withArray

        traverseFields({
          _locales: withArray.with._locales,
          adapter,
          currentArgs: withArray,
          currentTableName: arrayTableName,
          depth,
          fields: field.flattenedFields,
          joinQuery,
          locale,
          path: '',
          select: typeof arraySelect === 'object' ? arraySelect : undefined,
          selectMode,
          tablePath: '',
          topLevelArgs,
          topLevelTableName,
          withinLocalizedField: withinLocalizedField || field.localized,
          withTabledFields,
        })

        if (
          typeof arraySelect === 'object' &&
          withArray.with._locales &&
          Object.keys(withArray.with._locales).length === 1
        ) {
          delete withArray.with._locales
        }

        break
      }

      case 'blocks': {
        const blocksSelect = selectAllOnCurrentLevel ? true : select?.[field.name]

        if (select) {
          if (
            (selectMode === 'include' && !blocksSelect) ||
            (selectMode === 'exclude' && blocksSelect === false)
          ) {
            break
          }
        }

        ;(field.blockReferences ?? field.blocks).forEach((_block) => {
          const block = typeof _block === 'string' ? adapter.payload.blocks[_block] : _block
          const blockKey = `_blocks_${block.slug}`

          let blockSelect: boolean | SelectType | undefined

          let blockSelectMode = selectMode

          if (selectMode === 'include' && blocksSelect === true) {
            blockSelect = true
          }

          if (typeof blocksSelect === 'object') {
            if (typeof blocksSelect[block.slug] === 'object') {
              blockSelect = blocksSelect[block.slug]
            } else if (
              (selectMode === 'include' && typeof blocksSelect[block.slug] === 'undefined') ||
              (selectMode === 'exclude' && blocksSelect[block.slug] === false)
            ) {
              blockSelect = {}
              blockSelectMode = 'include'
            } else if (selectMode === 'include' && blocksSelect[block.slug] === true) {
              blockSelect = true
            }
          }

          if (!topLevelArgs[blockKey]) {
            const withBlock: Result = {
              columns:
                typeof blockSelect === 'object'
                  ? {
                      id: true,
                      _order: true,
                      _path: true,
                    }
                  : {
                      _parentID: false,
                    },
              orderBy: ({ _order }, { asc }) => [asc(_order)],
              with: {},
            }

            const tableName = adapter.tableNameMap.get(
              `${topLevelTableName}_blocks_${toSnakeCase(block.slug)}`,
            )

            if (typeof blockSelect === 'object') {
              if (adapter.tables[tableName]._locale) {
                withBlock.columns._locale = true
              }

              if (adapter.tables[tableName]._uuid) {
                withBlock.columns._uuid = true
              }
            }

            if (adapter.tables[`${tableName}${adapter.localesSuffix}`]) {
              withBlock.with._locales = {
                with: {},
              }

              if (typeof blockSelect === 'object') {
                withBlock.with._locales.columns = {
                  _locale: true,
                }
              }
            }
            topLevelArgs.with[blockKey] = withBlock

            traverseFields({
              _locales: withBlock.with._locales,
              adapter,
              currentArgs: withBlock,
              currentTableName: tableName,
              depth,
              fields: block.flattenedFields,
              joinQuery,
              locale,
              path: '',
              select: typeof blockSelect === 'object' ? blockSelect : undefined,
              selectMode: blockSelectMode,
              tablePath: '',
              topLevelArgs,
              topLevelTableName,
              withinLocalizedField: withinLocalizedField || field.localized,
              withTabledFields,
            })

            if (
              typeof blockSelect === 'object' &&
              withBlock.with._locales &&
              Object.keys(withBlock.with._locales.columns).length === 1
            ) {
              delete withBlock.with._locales
            }
          }
        })

        break
      }

      case 'group':
      case 'tab': {
        const fieldSelect = select?.[field.name]

        if (fieldSelect === false) {
          break
        }

        traverseFields({
          _locales,
          adapter,
          collectionSlug,
          currentArgs,
          currentTableName,
          depth,
          fields: field.flattenedFields,
          joinQuery,
          joins,
          locale,
          path: `${path}${field.name}_`,
          select: typeof fieldSelect === 'object' ? fieldSelect : undefined,
          selectAllOnCurrentLevel:
            selectAllOnCurrentLevel ||
            fieldSelect === true ||
            (selectMode === 'exclude' && typeof fieldSelect === 'undefined'),
          selectMode,
          tablePath: `${tablePath}${toSnakeCase(field.name)}_`,
          topLevelArgs,
          topLevelTableName,
          versions,
          withinLocalizedField: withinLocalizedField || field.localized,
          withTabledFields,
        })

        break
      }
      case 'join': {
        // when `joinsQuery` is false, do not join
        if (joinQuery === false) {
          break
        }

        if (
          (select && selectMode === 'include' && !select[field.name]) ||
          (selectMode === 'exclude' && select[field.name] === false)
        ) {
          break
        }

        const joinSchemaPath = `${path.replaceAll('_', '.')}${field.name}`

        if (joinQuery[joinSchemaPath] === false) {
          break
        }

        const {
          limit: limitArg = field.defaultLimit ?? 10,
          sort = field.defaultSort,
          where,
        } = joinQuery[joinSchemaPath] || {}
        let limit = limitArg

        if (limit !== 0) {
          // get an additional document and slice it later to determine if there is a next page
          limit += 1
        }

        const fields = adapter.payload.collections[field.collection].config.flattenedFields

        const joinCollectionTableName = adapter.tableNameMap.get(toSnakeCase(field.collection))

        const joins: BuildQueryJoinAliases = []

        const currentIDColumn = versions
          ? adapter.tables[currentTableName].parent
          : adapter.tables[currentTableName].id

        let joinQueryWhere: Where

        if (Array.isArray(field.targetField.relationTo)) {
          joinQueryWhere = {
            [field.on]: {
              equals: {
                relationTo: collectionSlug,
                value: rawConstraint(currentIDColumn),
              },
            },
          }
        } else {
          joinQueryWhere = {
            [field.on]: {
              equals: rawConstraint(currentIDColumn),
            },
          }
        }

        if (where && Object.keys(where).length) {
          joinQueryWhere = {
            and: [joinQueryWhere, where],
          }
        }

        const columnName = `${path.replaceAll('.', '_')}${field.name}`

        const subQueryAlias = `${columnName}_alias`

        const { newAliasTable } = getTableAlias({
          adapter,
          tableName: joinCollectionTableName,
        })

        const {
          orderBy,
          selectFields,
          where: subQueryWhere,
        } = buildQuery({
          adapter,
          aliasTable: newAliasTable,
          fields,
          joins,
          locale,
          selectLocale: true,
          sort,
          tableName: joinCollectionTableName,
          where: joinQueryWhere,
        })

        const chainedMethods: ChainedMethods = []

        joins.forEach(({ type, condition, table }) => {
          chainedMethods.push({
            args: [table, condition],
            method: type ?? 'leftJoin',
          })
        })

        if (limit !== 0) {
          chainedMethods.push({
            args: [limit],
            method: 'limit',
          })
        }

        const db = adapter.drizzle as LibSQLDatabase

        for (let key in selectFields) {
          const val = selectFields[key]

          if (val.table && getNameFromDrizzleTable(val.table) === joinCollectionTableName) {
            delete selectFields[key]
            key = key.split('.').pop()
            selectFields[key] = newAliasTable[key]
          }
        }

        const subQuery = chainMethods({
          methods: chainedMethods,
          query: db
            .select(selectFields as any)
            .from(newAliasTable)
            .where(subQueryWhere)
            .orderBy(() => orderBy.map(({ column, order }) => order(column))),
        }).as(subQueryAlias)

        currentArgs.extras[columnName] = sql`${db
          .select({
            result: jsonAggBuildObject(adapter, {
              id: sql.raw(`"${subQueryAlias}".id`),
              ...(selectFields._locale && {
                locale: sql.raw(`"${subQueryAlias}".${selectFields._locale.name}`),
              }),
            }),
          })
          .from(sql`${subQuery}`)}`.as(subQueryAlias)

        break
      }

      case 'point': {
        if (adapter.name === 'sqlite') {
          break
        }

        const args = field.localized ? _locales : currentArgs
        if (!args.columns) {
          args.columns = {}
        }

        if (!args.extras) {
          args.extras = {}
        }

        const name = `${path}${field.name}`

        // Drizzle handles that poorly. See https://github.com/drizzle-team/drizzle-orm/issues/2526
        // Additionally, this way we format the column value straight in the database using ST_AsGeoJSON
        args.columns[name] = false

        let shouldSelect = false

        if (select || selectAllOnCurrentLevel) {
          if (
            selectAllOnCurrentLevel ||
            (selectMode === 'include' && select[field.name] === true) ||
            (selectMode === 'exclude' && typeof select[field.name] === 'undefined')
          ) {
            shouldSelect = true
          }
        } else {
          shouldSelect = true
        }

        if (shouldSelect) {
          args.extras[name] = sql.raw(`ST_AsGeoJSON(${toSnakeCase(name)})::jsonb`).as(name)
        }
        break
      }

      case 'select': {
        if (select && !selectAllOnCurrentLevel) {
          if (
            (selectMode === 'include' && !select[field.name]) ||
            (selectMode === 'exclude' && select[field.name] === false)
          ) {
            break
          }
        }

        if (field.hasMany) {
          const withSelect: Result = {
            columns: {
              id: false,
              order: false,
              parent: false,
            },
            orderBy: ({ order }, { asc }) => [asc(order)],
          }

          currentArgs.with[`${path}${field.name}`] = withSelect
          break
        }

        if (select || selectAllOnCurrentLevel) {
          const fieldPath = `${path}${field.name}`

          if ((field.localized || withinLocalizedField) && _locales) {
            _locales.columns[fieldPath] = true
          } else if (adapter.tables[currentTableName]?.[fieldPath]) {
            currentArgs.columns[fieldPath] = true
          }
        }

        break
      }

      default: {
        if (!select && !selectAllOnCurrentLevel) {
          break
        }

        if (
          selectAllOnCurrentLevel ||
          (selectMode === 'include' && select[field.name] === true) ||
          (selectMode === 'exclude' && typeof select[field.name] === 'undefined')
        ) {
          const fieldPath = `${path}${field.name}`

          if ((field.localized || withinLocalizedField) && _locales) {
            _locales.columns[fieldPath] = true
          } else if (adapter.tables[currentTableName]?.[fieldPath]) {
            currentArgs.columns[fieldPath] = true
          }

          if (
            !withTabledFields.rels &&
            (field.type === 'relationship' || field.type === 'upload') &&
            (field.hasMany || Array.isArray(field.relationTo))
          ) {
            withTabledFields.rels = true
          }

          if (!withTabledFields.numbers && field.type === 'number' && field.hasMany) {
            withTabledFields.numbers = true
          }

          if (!withTabledFields.texts && field.type === 'text' && field.hasMany) {
            withTabledFields.texts = true
          }
        }

        break
      }
    }
  })

  return topLevelArgs
}
