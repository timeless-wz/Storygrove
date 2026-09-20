// 底图和地点使用同一套逻辑坐标。图片在这个逻辑区域内居中渲染；地点已有的
// 坐标不随原图尺寸改变，避免替换图片后标记整体跳位。
export const MAP_IMAGE_SIZE = { width: 1200, height: 900 }
export const MIN_MAP_ZOOM = 0.1
export const MAX_MAP_ZOOM = 3

const MAP_IMAGE_PADDING = 24

function getVisibleImageSize(imageSize: { width: number; height: number }) {
  const aspectRatio = imageSize.width / imageSize.height
  const mapAspectRatio = MAP_IMAGE_SIZE.width / MAP_IMAGE_SIZE.height
  return aspectRatio <= mapAspectRatio
    ? { width: MAP_IMAGE_SIZE.height * aspectRatio, height: MAP_IMAGE_SIZE.height }
    : { width: MAP_IMAGE_SIZE.width, height: MAP_IMAGE_SIZE.width / aspectRatio }
}

/**
 * 为实际图片内容计算适配视图。竖版图放进 1200×900 的逻辑区域时会出现 SVG
 * 留白；缩放必须忽略这些留白，才能让完整地图在侧边栏展开时仍然清晰可读。
 */
export function getMapImageFitTransform(
  viewportWidth: number,
  viewportHeight: number,
  imageSize: { width: number; height: number } = MAP_IMAGE_SIZE,
) {
  const availableWidth = viewportWidth - MAP_IMAGE_PADDING * 2
  const availableHeight = viewportHeight - MAP_IMAGE_PADDING * 2
  const visibleImageSize = getVisibleImageSize(imageSize)
  const zoom = Math.min(
    Math.max(Math.min(availableWidth / visibleImageSize.width, availableHeight / visibleImageSize.height), MIN_MAP_ZOOM),
    MAX_MAP_ZOOM,
  )

  return {
    zoom,
    pan: {
      x: (viewportWidth - MAP_IMAGE_SIZE.width * zoom) / 2,
      y: (viewportHeight - MAP_IMAGE_SIZE.height * zoom) / 2,
    },
  }
}
