/**
 * Range Analyzer for Smart Auto-Allocation (Feature #2)
 *
 * Analyzes existing port ranges and finds optimal placement for new service types.
 * Supports multiple placement strategies: after, before, and smart.
 */

class RangeAnalyzer {
  /**
   * Find the next available port range for a new service type
   *
   * @param {number} chunkSize - Number of ports to allocate
   * @param {string} placement - Placement strategy: 'after', 'before', or 'smart'
   * @param {object} config - Auto-allocation configuration
   * @param {object} existingServiceTypes - Map of existing service types with port ranges
   * @param {string} serviceType - Service type name (for smart placement)
   * @returns {array} [startPort, endPort]
   */
  static findNextAvailableRange(chunkSize, placement, config, existingServiceTypes = {}, serviceType = null) {
    const existingRanges = this.extractRanges(existingServiceTypes);

    switch (placement) {
      case 'before':
        return this.findBeforePlacement(chunkSize, existingRanges, config);

      case 'smart':
        return this.findSmartPlacement(chunkSize, existingRanges, config, serviceType);

      case 'after':
      default:
        return this.findAfterPlacement(chunkSize, existingRanges, config);
    }
  }

  /**
   * Extract port ranges from service type definitions
   */
  static extractRanges(serviceTypes) {
    const ranges = [];

    for (const [typeName, config] of Object.entries(serviceTypes)) {
      if (config.range && Array.isArray(config.range) && config.range.length === 2) {
        ranges.push({
          name: typeName,
          start: config.range[0],
          end: config.range[1]
        });
      }
    }

    // Sort by start port
    ranges.sort((a, b) => a.start - b.start);

    return ranges;
  }

  /**
   * Find placement after the last existing range (safest, default)
   */
  static findAfterPlacement(chunkSize, existingRanges, config) {
    if (existingRanges.length === 0) {
      // No existing ranges, start at min_port
      const start = config.min_port || 10000;
      return [start, start + chunkSize - 1];
    }

    // Find the highest end port
    const maxEndPort = Math.max(...existingRanges.map(r => r.end));

    // Add gap if configured
    const gap = config.preserve_gaps ? (config.gap_size || 10) : 0;
    const start = maxEndPort + gap + 1;
    const end = start + chunkSize - 1;

    // Verify within max_port boundary
    if (end > (config.max_port || 65000)) {
      throw new Error(`Cannot allocate range: exceeds max_port (${config.max_port || 65000})`);
    }

    return [start, end];
  }

  /**
   * Find placement before the first existing range
   */
  static findBeforePlacement(chunkSize, existingRanges, config) {
    if (existingRanges.length === 0) {
      // No existing ranges, start at min_port
      const start = config.min_port || 10000;
      return [start, start + chunkSize - 1];
    }

    // Find the lowest start port
    const minStartPort = Math.min(...existingRanges.map(r => r.start));

    // Add gap if configured
    const gap = config.preserve_gaps ? (config.gap_size || 10) : 0;
    const end = minStartPort - gap - 1;
    const start = end - chunkSize + 1;

    // Verify within min_port boundary
    if (start < (config.min_port || 10000)) {
      throw new Error(`Cannot allocate range: below min_port (${config.min_port || 10000})`);
    }

    return [start, end];
  }

  /**
   * Find smart placement based on service type patterns and available gaps
   */
  static findSmartPlacement(chunkSize, existingRanges, config, serviceType) {
    // Try to find a gap first
    const gap = this.findGapInRanges(existingRanges, chunkSize, config);
    if (gap) {
      return gap;
    }

    // If no suitable gap, try pattern-based placement
    const patternPlacement = this.findPatternBasedPlacement(serviceType, chunkSize, existingRanges, config);
    if (patternPlacement) {
      return patternPlacement;
    }

    // Fallback to 'after' placement
    return this.findAfterPlacement(chunkSize, existingRanges, config);
  }

  /**
   * Find a gap between existing ranges that can fit the required size
   */
  static findGapInRanges(existingRanges, requiredSize, config) {
    if (existingRanges.length < 2) {
      return null; // Need at least 2 ranges to have a gap
    }

    const gap = config.preserve_gaps ? (config.gap_size || 10) : 0;
    const totalRequired = requiredSize + (gap * 2); // Gap before and after

    for (let i = 0; i < existingRanges.length - 1; i++) {
      const currentEnd = existingRanges[i].end;
      const nextStart = existingRanges[i + 1].start;
      const gapSize = nextStart - currentEnd - 1;

      if (gapSize >= totalRequired) {
        // Found a suitable gap
        const start = currentEnd + gap + 1;
        const end = start + requiredSize - 1;
        return [start, end];
      }
    }

    return null; // No suitable gap found
  }

  /**
   * Find placement based on service type naming patterns
   * Groups similar services together (e.g., monitoring tools near other monitoring tools)
   */
  static findPatternBasedPlacement(serviceType, chunkSize, existingRanges, config) {
    if (!serviceType) {
      return null;
    }

    // Extract category from service type name
    const category = this.extractCategory(serviceType);

    // Find existing ranges with similar category
    const similarRanges = existingRanges.filter(range => {
      const rangeCategory = this.extractCategory(range.name);
      return rangeCategory === category;
    });

    if (similarRanges.length === 0) {
      return null; // No similar services found
    }

    // Try to place near similar services
    // Find the highest end port of similar services
    const maxEndPort = Math.max(...similarRanges.map(r => r.end));
    const gap = config.preserve_gaps ? (config.gap_size || 10) : 0;
    const start = maxEndPort + gap + 1;
    const end = start + chunkSize - 1;

    // Verify no collision with next range
    const nextRange = existingRanges.find(r => r.start > maxEndPort);
    if (nextRange && end + gap >= nextRange.start) {
      return null; // Would collide with next range
    }

    // Verify within boundaries
    if (end > (config.max_port || 65000)) {
      return null;
    }

    return [start, end];
  }

  /**
   * Extract category from service type name
   * Examples: "monitoring-grafana" → "monitoring", "database-postgres" → "database"
   */
  static extractCategory(serviceTypeName) {
    if (!serviceTypeName || typeof serviceTypeName !== 'string') {
      return '';
    }

    // Check if name contains hyphen (category-specific pattern)
    if (serviceTypeName.includes('-')) {
      return serviceTypeName.split('-')[0];
    }

    // Check for common category keywords
    const keywords = ['monitor', 'database', 'db', 'api', 'test', 'doc', 'build', 'ai', 'ml'];
    for (const keyword of keywords) {
      if (serviceTypeName.toLowerCase().includes(keyword)) {
        return keyword;
      }
    }

    return serviceTypeName.toLowerCase();
  }

  /**
   * Detect collisions between proposed range and existing ranges
   */
  static detectCollisions(proposedRange, existingRanges) {
    const [proposedStart, proposedEnd] = proposedRange;
    const collisions = [];

    for (const range of existingRanges) {
      // Check for overlap
      if (this.rangesOverlap(proposedStart, proposedEnd, range.start, range.end)) {
        collisions.push(range);
      }
    }

    return collisions;
  }

  /**
   * Check if two ranges overlap
   */
  static rangesOverlap(start1, end1, start2, end2) {
    return (start1 <= end2 && end1 >= start2);
  }

  /**
   * Verify proposed range is valid and collision-free
   */
  static verifyRange(proposedRange, existingRanges, config) {
    const [start, end] = proposedRange;

    // Verify basic validity
    if (start >= end) {
      throw new Error(`Invalid range: start (${start}) must be less than end (${end})`);
    }

    // Verify within boundaries
    const minPort = config.min_port || 10000;
    const maxPort = config.max_port || 65000;

    if (start < minPort) {
      throw new Error(`Range start (${start}) is below min_port (${minPort})`);
    }

    if (end > maxPort) {
      throw new Error(`Range end (${end}) exceeds max_port (${maxPort})`);
    }

    // Check for collisions
    const collisions = this.detectCollisions(proposedRange, existingRanges);
    if (collisions.length > 0) {
      const collisionNames = collisions.map(c => c.name).join(', ');
      throw new Error(`Range [${start}-${end}] collides with existing service(s): ${collisionNames}`);
    }

    return true;
  }

  /**
   * Calculate statistics about port range usage
   */
  static calculateStatistics(existingRanges, config) {
    const minPort = config.min_port || 10000;
    const maxPort = config.max_port || 65000;
    const totalAvailable = maxPort - minPort + 1;

    let totalAllocated = 0;
    for (const range of existingRanges) {
      totalAllocated += (range.end - range.start + 1);
    }

    const totalFree = totalAvailable - totalAllocated;
    const utilizationPercent = (totalAllocated / totalAvailable) * 100;

    return {
      totalAvailable,
      totalAllocated,
      totalFree,
      utilizationPercent: Math.round(utilizationPercent * 100) / 100,
      rangeCount: existingRanges.length
    };
  }
}

module.exports = RangeAnalyzer;
