"""Build the offline navigation gazetteer. Requires shapely; never alters radar data.

Natural Earth public-domain vectors, pinned to the revision below. Polygon
simplification is for regional navigation, not survey or jurisdiction decisions.
Run: python3 Tools/build_region_atlas.py
"""
from pathlib import Path
import hashlib,json,urllib.request
from shapely.geometry import shape,mapping

REVISION='ca96624a56bd078437bca8184e78163e5039ad19'
ROOT=Path(__file__).resolve().parents[1]
SOURCES={
 'countries':'ne_10m_admin_0_countries',
 'provinces':'ne_10m_admin_1_states_provinces',
 'landscapes':'ne_10m_geography_regions_polys',
 'waters':'ne_10m_geography_marine_polys',
 'lakes':'ne_50m_lakes',
}

def rounded(value):
 if isinstance(value,(tuple,list)):return [rounded(v) for v in value]
 return round(value,3)

def main():
 result={'revision':REVISION,'license':'Public domain','source':'https://www.naturalearthdata.com/','layers':{},'files':[]}
 for layer,name in SOURCES.items():
  url=f'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/{REVISION}/geojson/{name}.geojson'
  cache=Path('/tmp')/(name+'-'+REVISION+'.geojson')
  if not cache.exists():
   req=urllib.request.Request(url,headers={'User-Agent':'Fringe-region-atlas-builder/1.0'})
   cache.write_bytes(urllib.request.urlopen(req,timeout=120).read())
  raw=cache.read_bytes();features=json.loads(raw)['features'];records=[]
  for f in features:
   p={k.lower():v for k,v in f['properties'].items()};label=p.get('name_en') or p.get('name')
   if not label or p.get('featurecla')=='Dragons-be-here':continue
   geom=shape(f['geometry']).simplify(.03,preserve_topology=True)
   if geom.is_empty or geom.geom_type not in ('Polygon','MultiPolygon'):continue
   coords=mapping(geom)['coordinates'];polygons=[coords] if geom.geom_type=='Polygon' else coords
   record={'id':str(p.get('adm1_code') or p.get('adm0_a3') or p.get('ne_id') or p.get('scalerank')),
    'name':label,'kind':p.get('type_en') or p.get('featurecla') or 'Region',
    'q':p.get('wikidataid'),'country':p.get('admin'),'countryCode':p.get('adm0_a3'),
    'continent':p.get('continent') or p.get('region'),'subregion':p.get('subregion'),
    'wiki':p.get('wikipedia'),'area':round(geom.area,7),
    'polygons':[{'bounds':rounded(shape({'type':'Polygon','coordinates':poly}).bounds),'rings':rounded(poly)} for poly in polygons]}
   records.append({k:v for k,v in record.items() if v is not None})
  result['layers'][layer]=records
  result['files'].append({'name':name,'url':url,'sha256':hashlib.sha256(raw).hexdigest(),'features':len(records)})
  print(layer,len(records),flush=True)
 out=ROOT/'data/geography/atlas.json';out.parent.mkdir(parents=True,exist_ok=True)
 out.write_text(json.dumps(result,ensure_ascii=False,separators=(',',':'))+'\n')
 print(out.relative_to(ROOT),out.stat().st_size,'bytes')

if __name__=='__main__':main()
