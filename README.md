# claude-code-cockpit

Cockpit para Claude Code: una barra encima del prompt con colores y barras de progreso, y un diálogo de analíticas de la sesión.

**Barra** (se refresca cada `refreshSeconds`, por defecto 5 s, y al terminar cada turno):

```
◆ Opus 5.5 (medium) │ ctx ▕████░░░░░░▏ 42% │ 5h ▕██░░░░░░▏ 23% ↻18:40 │ sem ▕█░░░░░░░▏ 12% ↻lun 09:00 │ cache 3m │ $1.23 API
```

- Verde < 50 %, amarillo < 80 %, rojo ≥ 80 %.
- El coste es el equivalente a haber pagado la sesión con la API (el total que calcula Claude Code).
- Si el terminal es estrecho, la barra va quitando detalles.

**Diálogo de analíticas**: clic en la barra (terminal a pantalla completa), tecla `c` con la barra enfocada (`ctrl+x tab`) o `/cockpit`. Muestra resumen, coste por hora, contexto y límites, tokens por tipo, aciertos y ahorro de caché, coste estimado por modelo, herramientas más usadas y coste por turno. `q` o `Esc` lo cierran.

## Instalación

```
/plugin install code-cockpit --marketplace ruxwez/claude-status-line-plugin
```

El plugin se llama `code-cockpit` porque Claude Code reserva los nombres que empiezan por `claude-`.

## Opciones

| Opción | Por defecto | Qué hace |
| --- | --- | --- |
| `refreshSeconds` | 5 | Cada cuántos segundos se actualiza la barra |
| `cacheTtlMinutes` | 5 | Minutos que la caché de prompts se considera caliente |

## Desarrollo

```
claude plugin validate .
claude plugin test .
claude --plugin-dir .
```
