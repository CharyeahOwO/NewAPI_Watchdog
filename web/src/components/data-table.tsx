import * as React from "react"
import {
  type ColumnDef,
  type ColumnFiltersState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table"
import { motion } from "framer-motion"
import { ChevronLeft, ChevronRight, Inbox, Search } from "lucide-react"
import { Combobox } from "@/components/ui/combobox"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/empty-state"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

const pageSizeOptions = [10, 20, 50, 100].map((pageSize) => ({
  value: String(pageSize),
  label: String(pageSize),
}))

type DataTableProps<TData, TValue> = {
  columns: ColumnDef<TData, TValue>[]
  data: TData[]
  searchKey?: string
  searchPlaceholder?: string
  loading?: boolean
}

export function DataTable<TData, TValue>({
  columns,
  data,
  searchKey,
  searchPlaceholder = "搜索",
  loading = false,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([])
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    state: {
      sorting,
      columnFilters,
    },
  })

  return (
    <div className="overflow-hidden rounded-xl border border-stone-200 bg-card shadow-paper">
      <div className="flex flex-col gap-3 border-b border-stone-100 p-4 sm:flex-row sm:items-center sm:justify-between">
        {searchKey ? (
          <div className="relative w-full max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
            <Input
              className="h-10 rounded-xl border-stone-200 bg-stone-50/60 pl-9 shadow-none transition-colors focus-visible:bg-white"
              placeholder={searchPlaceholder}
              value={(table.getColumn(searchKey)?.getFilterValue() as string) ?? ""}
              onChange={(event) => table.getColumn(searchKey)?.setFilterValue(event.target.value)}
            />
          </div>
        ) : <div />}
        <div className="text-sm text-stone-500">
          共 {table.getFilteredRowModel().rows.length} 条
        </div>
      </div>
      <div>
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 6 }).map((_, rowIndex) => (
                <TableRow key={`skeleton-${rowIndex}`}>
                  {columns.map((_column, cellIndex) => (
                    <TableCell key={cellIndex}>
                      <Skeleton className="h-5 w-full max-w-[12rem]" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row, index) => (
                <motion.tr
                  key={row.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1], delay: Math.min(index, 12) * 0.03 }}
                  className="border-b border-stone-100 transition-colors hover:bg-stone-50/70"
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
                  ))}
                </motion.tr>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="p-0">
                  <EmptyState icon={Inbox} title="暂无数据" description="尚未发现任何记录，先刷新渠道或执行一次巡检。" />
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <div className="flex flex-col gap-3 border-t border-stone-100 px-4 py-3 text-sm text-stone-500 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <span>
          当前第 {table.getState().pagination.pageIndex + 1} 页
          </span>
          <div className="flex items-center gap-2 whitespace-nowrap">
            每页
            <Combobox
              className="w-24"
              value={String(table.getState().pagination.pageSize)}
              onValueChange={(value) => table.setPageSize(Math.min(Number(value), 100))}
              options={pageSizeOptions}
              placeholder="10"
              side="top"
              searchable={false}
            />
            条
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
