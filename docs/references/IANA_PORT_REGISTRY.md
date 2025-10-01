# IANA Port Registry Reference

## Official Source
**IANA Service Name and Transport Protocol Port Number Registry**
https://www.iana.org/assignments/service-names-port-numbers/service-names-port-numbers.xhtml

## Port Categories (IANA Standard)

### System Ports (0-1023)
- **Usage**: Well-known services (HTTP, SSH, DNS, etc.)
- **Permission**: Requires root/administrator privileges
- **Styxy Policy**: Never allocate in this range

### Registered Ports (1024-49151)
- **Usage**: Registered services and applications
- **Permission**: User-level access allowed
- **Styxy Policy**:
  - 1024-9999: Reserved for defined service types
  - 10000-49151: Available for auto-allocation

### Dynamic/Ephemeral Ports (49152-65535)
- **Usage**: OS-assigned temporary ports for outbound connections
- **Permission**: User-level access
- **Styxy Policy**: Never allocate in this range (OS conflict risk)

## Critical Conflicts to Avoid

### Browser/Developer Tools
- 9222-9229: Chrome/Brave DevTools Protocol
- 6000-6100: Firefox remote debugging
- 35729: LiveReload

### Common Development Services
- 3306: MySQL
- 5432: PostgreSQL
- 6379: Redis
- 27017: MongoDB
- 8080: Common HTTP proxy
- 9090: Prometheus

## Styxy Safe Zones

```
Current Configuration:
├─ Defined Service Types: 3000-9999
│  └─ Explicit port ranges per service category
└─ Auto-Allocation Zone: 10000-49151
   └─ 10-port chunks with gaps
```

## References
- RFC 6335: Internet Assigned Numbers Authority (IANA) Procedures for the Management of the Service Name and Transport Protocol Port Number Registry
- Last Updated: 2025-09-30
