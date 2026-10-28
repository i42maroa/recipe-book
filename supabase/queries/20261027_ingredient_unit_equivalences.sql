-- Equivalencias propuestas para el catálogo consultado el 27/10/2026: 127 ingredientes.
-- Configura 43 ingredientes. No ejecutar como migración general: contiene IDs de este proyecto.
-- Pegar esta única sentencia en el SQL Editor de Supabase.
-- Son estimaciones culinarias iniciales, no pesos garantizados para cada pieza o marca.
-- Pesos netos aproximados listos para utilizar; los envases se definen en descripcion_unidad.
-- Referencias orientativas sobre medidas y variabilidad:
-- https://ucm.es/idinutricion/tablas-de-raciones-de-alimentos-y-medidas-caseras
-- https://www.madrid.org/bvirtual/BVCM009928.pdf
-- En la aplicación, permitir unidades equivale a tener unit_quantity no nulo.
-- Solo completa equivalencias vacías; conserva las que ya existan (incluida Dorada: 250 g).
-- Comprueba ID, nombre exacto y medida base actual para evitar actualizar otro ingrediente.
-- Leche y Nata para cocinar pasan de g a ml; no convierte cantidades de recetas o inventario.
-- No actualiza cantidades ni instantáneas en recetas, elaboraciones o lotes existentes.
-- Repetirla no sobrescribe equivalencias configuradas: si ya se aplicó, devuelve cero filas.

with equivalencias (id, nombre, base_actual, base_nueva, cantidad_unidad, descripcion_unidad) as (
  values
    ('9cddc772-fed6-4baa-bd46-921b58b44036', 'Aguacate', 'g', 'g', 150, 'Una pieza mediana, solo pulpa'),
    ('d9741ab1-58bb-437d-85ee-d90811ae952b', 'Ajo', 'g', 'g', 5, 'Un diente pelado, no una cabeza'),
    ('ed5ccbc6-5b1e-4e51-bd62-0aa0bee158c3', 'Alcachofa', 'g', 'g', 100, 'Parte aprovechable de una pieza mediana'),
    ('b893398b-7c04-40f8-806f-f71cb71de3b7', 'Almendras', 'g', 'g', 1.2, 'Una almendra sin cáscara'),
    ('a422b974-694b-44a1-9c0f-44ab220751bd', 'Berenjena', 'g', 'g', 250, 'Una pieza mediana'),
    ('50eb4883-30b2-449d-87b1-96c57317f4e0', 'Boniato', 'g', 'g', 200, 'Una pieza mediana'),
    ('67c1543a-f9e4-440b-8663-15c767969570', 'Brócoli', 'g', 'g', 300, 'Parte aprovechable de una cabeza mediana'),
    ('4382cef3-3e8a-4331-a8bf-4a476392fa61', 'Burrata', 'g', 'g', 125, 'Una bola, peso escurrido; referencia de 125 g'),
    ('b09a60cf-ef9b-40e7-8918-398b4cdb899c', 'Calabacín', 'g', 'g', 250, 'Una pieza mediana'),
    ('1084cf3a-a4f4-42a3-a9b2-75692daa60dd', 'Castañas', 'g', 'g', 10, 'Una castaña pelada'),
    ('cb9bc128-ee76-45ed-bb72-e80456ff72a2', 'Cebolla', 'g', 'g', 150, 'Una pieza mediana pelada'),
    ('4df73b5a-cb93-4780-99d0-d1523cb0fc2d', 'Cebolla roja', 'g', 'g', 150, 'Una pieza mediana pelada'),
    ('72f40511-7dcc-4d1f-b3cc-d5565de972e6', 'Champiñones', 'g', 'g', 20, 'Un champiñón mediano limpio'),
    ('b1dc23e8-2e03-488b-8ea9-b8827406a69b', 'Coliflor', 'g', 'g', 600, 'Parte aprovechable de una cabeza mediana'),
    ('0413305a-3fc7-4f2e-95ae-5cfcb9f0dceb', 'Esparragos', 'g', 'g', 20, 'Un espárrago mediano limpio'),
    ('ee7d29ca-d1d9-48d2-a834-2f44ee86389c', 'Fresas', 'g', 'g', 15, 'Una fresa mediana sin pedúnculo'),
    ('2642150f-4b61-4a69-b398-1eb98bf6d912', 'Huevo', 'g', 'g', 50, 'Un huevo de gallina sin cáscara'),
    ('5c7a34c9-0595-42d4-a612-49215f933567', 'Huevos de codorniz', 'g', 'g', 9, 'Un huevo de codorniz sin cáscara'),
    ('ff384963-05fc-4d3a-8beb-e20b546cb6ed', 'Leche', 'g', 'ml', 1000, 'Un envase de referencia de 1 litro'),
    ('06151b12-f42e-43cb-b9af-6da26a1c3865', 'Lechuga', 'g', 'g', 300, 'Una pieza mediana limpia, no una hoja'),
    ('ffdfd57f-9474-4bba-989e-7e5426bb39ff', 'Limón', 'g', 'g', 60, 'Parte aprovechable de una pieza mediana, no solo el zumo'),
    ('8c900769-c5fd-48d9-aa57-dca2cd8e3b86', 'Mango', 'g', 'g', 200, 'Una pieza mediana, sin piel ni hueso'),
    ('2c0bd811-ae51-44d1-9b71-c9fcd62cccd3', 'Manzana', 'g', 'g', 150, 'Una pieza mediana sin corazón'),
    ('261479d9-5b67-4709-859a-3f1ec255fe66', 'Mozzarella', 'g', 'g', 125, 'Una bola, peso escurrido; referencia de 125 g'),
    ('417155cb-31d7-4627-90bb-90b902dea871', 'Naranja', 'g', 'g', 150, 'Una pieza mediana pelada'),
    ('9cba779d-dbc0-4dfb-8d95-2e1d26aaf302', 'Nata para cocinar', 'g', 'ml', 200, 'Un envase de referencia de 200 ml'),
    ('56db44f3-98be-4d4e-b2cf-b9ee0f328cfe', 'Nueces', 'g', 'g', 4, 'Una nuez completa pelada, dos mitades'),
    ('452649c9-5240-480f-a114-cfc9770f3579', 'Patata', 'g', 'g', 170, 'Una pieza mediana pelada'),
    ('51a18de8-10ce-453c-a857-4d46199e3356', 'Pechuga pollo', 'g', 'g', 250, 'Una pechuga individual deshuesada y sin piel, no un filete'),
    ('7d32cd12-57c7-4215-9385-2c5252e6d05f', 'Pepino', 'g', 'g', 200, 'Una pieza mediana'),
    ('2fd71320-667b-44ad-9331-32fcdfc8d48b', 'Pimiento piquillo', 'g', 'g', 35, 'Un pimiento limpio y escurrido'),
    ('2f9d8e80-b98e-4b2c-9cd1-c30253899193', 'Pimiento rojo', 'g', 'g', 180, 'Una pieza mediana limpia'),
    ('94806cba-e5d3-4d06-a49e-ca1420cce1c2', 'Pimiento verde', 'g', 'g', 120, 'Una pieza mediana limpia'),
    ('895b76fa-786d-4f2e-a32b-f9283fcb81ca', 'Piña', 'g', 'g', 1000, 'Parte aprovechable de una pieza, sin piel ni centro duro'),
    ('601c63e1-ed76-48ff-9dca-8719a425e3a6', 'Plátano', 'g', 'g', 100, 'Una pieza mediana pelada'),
    ('cb562516-c366-4d6c-be55-5cc378d99780', 'Puerro', 'g', 'g', 75, 'Un puerro mediano limpio'),
    ('ba6b6a5b-af9f-43e2-87cc-905a368672bf', 'Queso mozarella', 'g', 'g', 125, 'Una bola, peso escurrido; referencia de 125 g'),
    ('18cc58dc-4325-4eec-8346-975eb2b7ba00', 'Remolacha', 'g', 'g', 150, 'Una pieza mediana limpia'),
    ('d15e795d-ca98-4b21-8ce2-8fad180a02d4', 'Tomate', 'g', 'g', 150, 'Una pieza mediana'),
    ('87eaa6a0-6ec5-410e-b5b4-04bf84941de4', 'Tomate cherry', 'g', 'g', 15, 'Una pieza mediana'),
    ('9bce385d-88f1-4f9f-b356-f269cc6171a8', 'Yogur griego', 'g', 'g', 125, 'Un envase individual de referencia de 125 g'),
    ('b72ad275-5b3c-42f2-8101-03f2748134c4', 'Yogur natural', 'g', 'g', 125, 'Un envase individual de referencia de 125 g'),
    ('7e12df4b-2506-4030-8f48-2a5d2a0a18cd', 'Zanahoria', 'g', 'g', 80, 'Una pieza mediana limpia')
), actualizados as (
  update public.ingredients as ingrediente
  set base_unit = equivalencia.base_nueva,
      unit_quantity = equivalencia.cantidad_unidad,
      updated_at = now()
  from equivalencias as equivalencia
  where ingrediente.id = equivalencia.id::uuid
    and ingrediente.name = equivalencia.nombre
    and ingrediente.base_unit = equivalencia.base_actual
    and ingrediente.unit_quantity is null
  returning ingrediente.id,
            ingrediente.name as ingrediente,
            ingrediente.base_unit as medida_base,
            ingrediente.unit_quantity as cantidad_por_unidad,
            equivalencia.descripcion_unidad
)
select * from actualizados order by ingrediente;
