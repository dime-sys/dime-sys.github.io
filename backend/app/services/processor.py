import pandas as pd


def _apply_null_strategy(df, strategy):
    if not strategy or strategy == "none":
        return df
    if strategy == "forward_fill":
        return df.ffill()
    if strategy == "backward_fill":
        return df.bfill()
    if strategy == "zero":
        return df.fillna(0)
    if strategy == "empty_string":
        return df.fillna("")
    return df


def _auto_cast_dataframe(df):
    casted = df.copy()
    for col in casted.columns:
        series = casted[col]
        if series.dtype == "object":
            numeric = pd.to_numeric(series, errors="coerce")
            numeric_ratio = numeric.notna().mean() if len(series) else 0
            if numeric_ratio >= 0.8:
                casted[col] = numeric
                continue

            datetime_series = pd.to_datetime(series, errors="coerce", dayfirst=True)
            datetime_ratio = datetime_series.notna().mean() if len(series) else 0
            if datetime_ratio >= 0.8:
                casted[col] = datetime_series
    return casted


def _apply_shape_transform(df, transform):
    transform = transform or {}
    mode = transform.get("mode", "none")

    if mode == "unpivot":
        id_columns = transform.get("id_columns", [])
        value_columns = transform.get("value_columns", []) or [c for c in df.columns if c not in id_columns]
        var_name = transform.get("var_name", "variable")
        value_name = transform.get("value_name", "value")
        return df.melt(
            id_vars=id_columns,
            value_vars=value_columns,
            var_name=var_name,
            value_name=value_name,
        )

    if mode == "pivot":
        index_columns = transform.get("index_columns", [])
        pivot_column = transform.get("pivot_column")
        value_column = transform.get("value_column")
        aggfunc = transform.get("aggfunc", "first")
        if not pivot_column or not value_column:
            raise ValueError("pivot requiere pivot_column y value_column")
        pivoted = (
            df.pivot_table(
                index=index_columns,
                columns=pivot_column,
                values=value_column,
                aggfunc=aggfunc,
            )
            .reset_index()
        )
        pivoted.columns = [str(c) for c in pivoted.columns]
        return pivoted

    return df


def _slice_columns(columns, start_col, end_col):
    if not columns:
        return []
    if start_col not in columns or end_col not in columns:
        return []
    start_index = columns.index(start_col)
    end_index = columns.index(end_col)
    left = min(start_index, end_index)
    right = max(start_index, end_index)
    return columns[left : right + 1]


def _trim_until_all_null(df, check_columns):
    if df.empty or not check_columns:
        return df.iloc[0:0]

    has_data_mask = df[check_columns].notna().any(axis=1).tolist()
    if True not in has_data_mask:
        return df.iloc[0:0]

    start_idx = has_data_mask.index(True)
    end_idx = len(has_data_mask)
    for idx in range(start_idx, len(has_data_mask)):
        if not has_data_mask[idx]:
            end_idx = idx
            break

    return df.iloc[start_idx:end_idx].reset_index(drop=True)


def _extract_vertical_block(df, key_column):
    if df.empty or key_column not in df.columns:
        return df.iloc[0:0]

    key_has_data = df[key_column].notna().tolist()
    if True not in key_has_data:
        return df.iloc[0:0]

    start_idx = key_has_data.index(True)
    row_all_null = df.isna().all(axis=1).tolist()
    end_idx = len(row_all_null)

    for idx in range(start_idx, len(row_all_null)):
        if row_all_null[idx]:
            end_idx = idx
            break

    block_df = df.iloc[start_idx:end_idx].copy()
    if block_df.empty:
        return block_df

    block_df = block_df[block_df[key_column].notna()].copy()
    return block_df.reset_index(drop=True)


def _trim_columns_until_all_null(df, start_col, row_start, row_end):
    if df.empty or start_col not in df.columns:
        return [], df.iloc[0:0]

    row_start = max(0, int(row_start))
    row_end = min(len(df), int(row_end))
    if row_end <= row_start:
        return [], df.iloc[0:0]

    block_rows = df.iloc[row_start:row_end].copy()
    all_columns = [str(c) for c in df.columns]
    start_idx = all_columns.index(start_col)
    candidate_cols = all_columns[start_idx:]

    col_has_data = [block_rows[col].notna().any() for col in candidate_cols]
    if True not in col_has_data:
        return [], block_rows.iloc[0:0]

    first_with_data = col_has_data.index(True)
    cut_idx = len(candidate_cols)
    for idx in range(first_with_data, len(col_has_data)):
        if not col_has_data[idx]:
            cut_idx = idx
            break

    selected_columns = candidate_cols[first_with_data:cut_idx]
    return selected_columns, block_rows[selected_columns].copy()


def _build_vertical_table(df, key_column, row_start, row_end):
    selected_columns, block_df = _trim_columns_until_all_null(df, key_column, row_start, row_end)
    if not selected_columns or block_df.empty:
        return df.iloc[0:0], []

    value_columns = [col for col in selected_columns if col != key_column]
    if not value_columns:
        return df.iloc[0:0], []

    key_series = block_df[key_column]
    valid_key_mask = key_series.notna() & (key_series.astype(str).str.strip() != "")
    key_labels = key_series[valid_key_mask].astype(str).tolist()
    if not key_labels:
        return df.iloc[0:0], []

    filtered_block = block_df[valid_key_mask].copy()
    records = []
    for value_col in value_columns:
        values = filtered_block[value_col].tolist()
        record = {key_labels[idx]: values[idx] for idx in range(len(key_labels))}
        records.append(record)

    vertical_df = pd.DataFrame(records)
    return vertical_df, key_labels


def _apply_single_table_rule(df, rule):
    table_name = rule.get("table_name") or "tabla"

    # Hacer una copia para no modificar el original
    df = df.copy()

    extraction_mode = rule.get("extraction_mode", "range")
    all_columns = [str(c) for c in df.columns]

    print(f"[processor.py] Inicio tabla '{table_name}' - shape: {df.shape}")
    print(f"[processor.py] extraction_mode: {extraction_mode}")

    if extraction_mode == "headers_horizontal":
        start_col = rule.get("horizontal_start_column") or (rule.get("columns") or [None])[0]
        end_col = rule.get("horizontal_end_column") or (rule.get("columns") or [None])[-1]
        anchor_row = int(rule.get("horizontal_anchor_row", 0) or 0)
        selected_columns = _slice_columns(all_columns, start_col, end_col)
        if not selected_columns:
            raise ValueError("No se pudieron determinar columnas para encabezados_horizontal")

        print(f"[processor.py] Horizontal columnas: {selected_columns}")
        df = df.iloc[max(anchor_row, 0) :][selected_columns].copy()
        df = _trim_until_all_null(df, selected_columns)
        print(f"[processor.py] Horizontal trimmed - shape: {df.shape}")

    elif extraction_mode == "headers_vertical":
        key_column = rule.get("vertical_header_column")
        start_row = rule.get("vertical_start_row")
        end_row = rule.get("vertical_end_row")

        if not key_column or key_column not in all_columns:
            raise ValueError("vertical_header_column es requerido y debe existir")

        if start_row is not None and end_row is not None:
            df, key_labels = _build_vertical_table(df, key_column, int(start_row), int(end_row))
            print(f"[processor.py] Vertical headers detectados: {key_labels}")
            print(f"[processor.py] Vertical transposed result - shape: {df.shape}")
        else:
            # Fallback para reglas antiguas sin rango de filas vertical
            block_df = _extract_vertical_block(df, key_column)
            if block_df.empty:
                print("[processor.py] Vertical block vacío")
                df = block_df
            else:
                selected_columns = [c for c in block_df.columns if block_df[c].notna().all()]
                if key_column not in selected_columns:
                    selected_columns.insert(0, key_column)
                # Compatibilidad antigua: convertir bloque vertical a estructura tabular
                temp_rule_start = int(rule.get("start_row", 0) or 0)
                temp_rule_end = int(rule.get("end_row", len(block_df)) or len(block_df))
                df, key_labels = _build_vertical_table(block_df[selected_columns].copy(), key_column, temp_rule_start, temp_rule_end)
                print(f"[processor.py] Vertical fallback headers: {key_labels}")
                print(f"[processor.py] Vertical fallback result - shape: {df.shape}")

    else:
        # Modo rango (comportamiento actual)
        start_row = rule.get("start_row", 0)
        end_row = rule.get("end_row", len(df))
        print(f"[processor.py] Filtrando filas: iloc[{start_row}:{end_row}]")

        df = df.iloc[start_row:end_row]
        print(f"[processor.py] Después de filtrar filas - shape: {df.shape}")

        columns = rule.get("columns", [])
        print(f"[processor.py] Columnas a seleccionar: {columns}")
        if columns:
            df = df[columns]
        print(f"[processor.py] Después de seleccionar columnas - shape: {df.shape}")

    # Aplicar headers
    header_option = rule.get("header_option")
    if extraction_mode == "headers_vertical" and header_option == "first_row":
        header_option = "keep_existing"
    print(f"[processor.py] header_option: {header_option}")

    if header_option == "first_row":
        # Usar la primera fila como encabezado
        if len(df) > 0:
            print(f"[processor.py] Usando primera fila como header")
            new_columns = df.iloc[0].tolist()
            print(f"[processor.py] Nuevas columnas: {new_columns}")
            df.columns = [str(col) for col in new_columns]
            # Eliminar la primera fila (que ahora es encabezado)
            df = df.iloc[1:].reset_index(drop=True)
            print(f"[processor.py] After removing header row - shape: {df.shape}")
        else:
            print(f"[processor.py] DataFrame vacío, no se puede usar primera fila como header")

    elif header_option == "keep_existing":
        # Conservar encabezados originales detectados por pandas/read_excel
        print(f"[processor.py] Manteniendo encabezados actuales sin cambios")

    elif header_option == "manual":
        # Usar nombres personalizados
        custom_headers = rule.get("custom_headers", [])
        print(f"[processor.py] custom_headers recibidos: {custom_headers}")

        # Filtrar headers vacíos - usar los nombres originales si está vacío
        filtered_headers = []
        for i, name in enumerate(custom_headers):
            if name and name.strip():
                filtered_headers.append(name.strip())
            else:
                col_name = str(df.columns[i]) if i < len(df.columns) else f"Column_{i}"
                filtered_headers.append(col_name)

        print(f"[processor.py] custom_headers filtrados: {filtered_headers}")

        # Asignar los headers
        if len(filtered_headers) == len(df.columns):
            df.columns = filtered_headers
            print(f"[processor.py] Columnas asignadas correctamente")
        else:
            print(f"[processor.py] Mismatch: {len(filtered_headers)} headers vs {len(df.columns)} columnas")

    # Transformaciones adicionales
    df = _apply_null_strategy(df, rule.get("null_strategy", "none"))
    if extraction_mode != "headers_vertical" and rule.get("auto_cast_types"):
        df = _auto_cast_dataframe(df)
    if extraction_mode != "headers_vertical":
        df = _apply_shape_transform(df, rule.get("shape_transform"))

    print(f"[processor.py] Final shape: {df.shape}")
    print(f"[processor.py] Final columns: {df.columns.tolist()}")
    return table_name, df


def apply_rules(df, rule):
    """
    Aplica reglas a un DataFrame:
    1. Filtra filas según start_row y end_row
    2. Selecciona columnas según 'columns'
    3. Aplica nombres de columnas según header_option:
       - "first_row": usa la primera fila como header
       - "manual": usa custom_headers
       - None/default: mantiene los nombres originales
    """
    tables = rule.get("tables") if isinstance(rule, dict) else None
    if tables:
        result = {}
        for table_rule in tables:
            table_name, table_df = _apply_single_table_rule(df, table_rule)
            result[table_name] = table_df
        return result

    _, df_result = _apply_single_table_rule(df, rule)
    return df_result