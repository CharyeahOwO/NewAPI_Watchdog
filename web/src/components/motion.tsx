import * as React from "react"
import { motion, type Variants } from "framer-motion"
import { cn } from "@/lib/utils"

/**
 * 全站统一的入场动画原语。
 * 原本只有「总览」页用到这套交错淡入上移，现在抽出来供所有页面复用，
 * 保持纸质暖石色控制台一致的进场观感。
 */

const easeOut: [number, number, number, number] = [0.22, 1, 0.36, 1]

export const containerVariants: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.07, delayChildren: 0.04 },
  },
}

export const itemVariants: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: easeOut } },
}

// 列表/表格行更密集，用更短的位移与更紧凑的交错，避免长列表拖沓。
export const rowContainerVariants: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.03, delayChildren: 0.02 },
  },
}

export const rowVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3, ease: easeOut } },
}

/** 整页容器：交错触发子元素入场。配合 <StaggerItem> 使用。 */
export function PageTransition({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <motion.div
      className={cn("space-y-6", className)}
      initial="hidden"
      animate="show"
      variants={containerVariants}
    >
      {children}
    </motion.div>
  )
}

/** 页内单个交错入场单元。 */
export function StaggerItem({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <motion.div className={className} variants={itemVariants}>
      {children}
    </motion.div>
  )
}

/** 行容器：用于日志/巡检等手写列表，行级密集交错。 */
export function StaggerRows({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <motion.div
      className={className}
      initial="hidden"
      animate="show"
      variants={rowContainerVariants}
    >
      {children}
    </motion.div>
  )
}

/** 单行入场单元。 */
export function StaggerRow({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <motion.div className={className} variants={rowVariants}>
      {children}
    </motion.div>
  )
}
