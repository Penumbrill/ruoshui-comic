import importlib.util,pathlib,unittest,tempfile,hashlib,json
import torch
ROOT=pathlib.Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location('moge_nodes',ROOT/'assets/moge-nodes/__init__.py');nodes=importlib.util.module_from_spec(spec);spec.loader.exec_module(nodes)
spec2=importlib.util.spec_from_file_location('downloader',ROOT/'assets/download_models.py');dl=importlib.util.module_from_spec(spec2);spec2.loader.exec_module(dl)
class InpaintTest(unittest.TestCase):
 def test_composite_preserves_unmasked_pixels_and_native_dimensions(self):
  image=torch.rand(1,117,203,3);mask=torch.zeros(1,117,203);mask[:,30:70,70:120]=1
  crop,noise,ctx=nodes.MogePrepareInpaint().prepare(image,mask,0,False,True,16,0,512)
  self.assertEqual(crop.shape[1]%16,0);self.assertEqual(crop.shape[2]%16,0)
  result,=nodes.MogeCompositeInpaint().composite(torch.ones_like(crop),ctx)
  self.assertEqual(tuple(result.shape),tuple(image.shape));self.assertTrue(torch.equal(result[mask==0],image[mask==0]));self.assertTrue(torch.all(result[mask==1]>.999))
 def test_blurred_feather_also_preserves_all_unpainted_pixels(self):
  image=torch.rand(1,96,128,3);mask=torch.zeros(1,96,128);mask[:,30:60,45:85]=1
  crop,noise,ctx=nodes.MogePrepareInpaint().prepare(image,mask,6,False,True,20,0,512)
  result,=nodes.MogeCompositeInpaint().composite(torch.ones_like(crop),ctx)
  self.assertTrue(torch.equal(result[mask==0],image[mask==0]))
 def test_empty_mask_is_rejected(self):
  with self.assertRaisesRegex(ValueError,'遮罩'):nodes.MogePrepareInpaint().prepare(torch.zeros(1,64,64,3),torch.zeros(1,64,64),4,False,False,32,0,512)
 def test_integrity_detects_same_size_corruption(self):
  with tempfile.TemporaryDirectory(prefix='moge-integrity-') as directory:
   root=pathlib.Path(directory);(root/'model.safetensors').write_bytes(b'correct');items=[{'target':'model.safetensors','size':7,'sha256':hashlib.sha256(b'correct').hexdigest()}]
   self.assertEqual(dl.check(items,root,True)[0]['state'],'verified');(root/'model.safetensors').write_bytes(b'corrupt');self.assertEqual(dl.check(items,root,True)[0]['state'],'invalid');(root/'model.safetensors').unlink();self.assertEqual(dl.check(items,root)[0]['state'],'missing')
if __name__=='__main__':unittest.main()
